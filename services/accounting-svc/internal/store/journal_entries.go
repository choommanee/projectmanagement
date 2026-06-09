package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/accounting-svc/internal/domain"
)

type JournalEntryStore struct{ p *pgxpool.Pool }

func NewJournalEntryStore(p *pgxpool.Pool) *JournalEntryStore { return &JournalEntryStore{p: p} }

const jeSelect = `
    SELECT id, tenant_id, ref_no, memo, status, entry_date,
           posted_at, created_by, created_at, updated_at, version
    FROM journal_entry`

func scanJE(row interface{ Scan(...any) error }, e *domain.JournalEntry) error {
	return row.Scan(
		&e.ID, &e.TenantID, &e.RefNo, &e.Memo, &e.Status, &e.EntryDate,
		&e.PostedAt, &e.CreatedBy, &e.CreatedAt, &e.UpdatedAt, &e.Version,
	)
}

func loadJELines(ctx context.Context, tx pgx.Tx, entryID uuid.UUID) ([]*domain.JournalLine, error) {
	rows, err := tx.Query(ctx, `
		SELECT id, tenant_id, entry_id, account_id, debit, credit, description, line_no
		FROM journal_line WHERE entry_id=$1 ORDER BY line_no ASC`, entryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var lines []*domain.JournalLine
	for rows.Next() {
		var l domain.JournalLine
		if err := rows.Scan(&l.ID, &l.TenantID, &l.EntryID, &l.AccountID,
			&l.Debit, &l.Credit, &l.Description, &l.LineNo); err != nil {
			return nil, err
		}
		lines = append(lines, &l)
	}
	return lines, rows.Err()
}

func (s *JournalEntryStore) Create(ctx context.Context, e *domain.JournalEntry) error {
	e.ID = uuid.New()
	e.CreatedAt = time.Now()
	e.UpdatedAt = e.CreatedAt
	e.Version = 1
	if e.Status == "" {
		e.Status = domain.JEStatusDraft
	}
	return withTenant(ctx, s.p, e.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO journal_entry(id, tenant_id, ref_no, memo, status, entry_date,
			                          created_by, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			e.ID, e.TenantID, e.RefNo, e.Memo, e.Status, e.EntryDate,
			e.CreatedBy, e.Version,
		)
		return err
	})
}

func (s *JournalEntryStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.JournalEntry, error) {
	var e domain.JournalEntry
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		if err := scanJE(tx.QueryRow(ctx, jeSelect+" WHERE id=$1", id), &e); err != nil {
			return err
		}
		lines, err := loadJELines(ctx, tx, id)
		if err != nil {
			return err
		}
		e.Lines = lines
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

type ListJEOpts struct {
	Status string
	From   string
	To     string
	Limit  int
	Offset int
}

func (s *JournalEntryStore) List(ctx context.Context, tid uuid.UUID, opts ListJEOpts) ([]*domain.JournalEntry, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if opts.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, opts.Status)
		idx++
	}
	if opts.From != "" {
		where = append(where, fmt.Sprintf("entry_date >= $%d", idx))
		args = append(args, opts.From)
		idx++
	}
	if opts.To != "" {
		where = append(where, fmt.Sprintf("entry_date <= $%d", idx))
		args = append(args, opts.To)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.JournalEntry
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			jeSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY entry_date DESC, ref_no ASC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var e domain.JournalEntry
			if err := scanJE(rows, &e); err != nil {
				return err
			}
			items = append(items, &e)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		// Batch-load lines for all returned entries in a single query so callers
		// (trial balance, reports, budget actuals) get fully-populated entries
		// without an N+1 round-trip per entry.
		if len(items) > 0 {
			ids := make([]uuid.UUID, len(items))
			byID := make(map[uuid.UUID]*domain.JournalEntry, len(items))
			for i, e := range items {
				ids[i] = e.ID
				e.Lines = []*domain.JournalLine{}
				byID[e.ID] = e
			}
			lrows, err := tx.Query(ctx, `
				SELECT id, tenant_id, entry_id, account_id, debit, credit, description, line_no
				FROM journal_line WHERE entry_id = ANY($1) ORDER BY entry_id, line_no ASC`, ids)
			if err != nil {
				return err
			}
			defer lrows.Close()
			for lrows.Next() {
				var l domain.JournalLine
				if err := lrows.Scan(&l.ID, &l.TenantID, &l.EntryID, &l.AccountID,
					&l.Debit, &l.Credit, &l.Description, &l.LineNo); err != nil {
					return err
				}
				if parent := byID[l.EntryID]; parent != nil {
					parent.Lines = append(parent.Lines, &l)
				}
			}
			if lrows.Err() != nil {
				return lrows.Err()
			}
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM journal_entry WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdateJEInput struct {
	Memo      string
	EntryDate time.Time
	Version   int
}

func (s *JournalEntryStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdateJEInput) (*domain.JournalEntry, error) {
	var e domain.JournalEntry
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE journal_entry
			SET memo=$3, entry_date=$4, updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$5 AND status='draft'`,
			id, tid, in.Memo, in.EntryDate, in.Version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		if err := scanJE(tx.QueryRow(ctx, jeSelect+" WHERE id=$1", id), &e); err != nil {
			return err
		}
		lines, err := loadJELines(ctx, tx, id)
		if err != nil {
			return err
		}
		e.Lines = lines
		return nil
	})
	if errors.Is(err, domain.ErrConflict) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

func (s *JournalEntryStore) Post(ctx context.Context, tid, id uuid.UUID, version int) (*domain.JournalEntry, error) {
	now := time.Now()
	var e domain.JournalEntry
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		// Double-entry integrity: a journal entry may only be posted when it
		// has at least one line and total debits equal total credits. Aggregate
		// in SQL (numeric, not float) to avoid rounding drift.
		var debits, credits float64
		var lineCount int
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0), COUNT(*)
			FROM journal_line WHERE entry_id=$1 AND tenant_id=$2`,
			id, tid,
		).Scan(&debits, &credits, &lineCount); err != nil {
			return err
		}
		if lineCount == 0 {
			return fmt.Errorf("%w: cannot post a journal entry with no lines", domain.ErrInvalidInput)
		}
		if debits <= 0 && credits <= 0 {
			return fmt.Errorf("%w: cannot post a journal entry with zero amounts", domain.ErrInvalidInput)
		}
		// numeric(18,4) precision → compare at sub-cent tolerance.
		if diff := debits - credits; diff > 0.00005 || diff < -0.00005 {
			return fmt.Errorf("%w: debits (%.4f) must equal credits (%.4f)", domain.ErrInvalidInput, debits, credits)
		}

		ct, err := tx.Exec(ctx, `
			UPDATE journal_entry
			SET status='posted', posted_at=$3, updated_at=$3, version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$4 AND status='draft'`,
			id, tid, now, version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		if err := scanJE(tx.QueryRow(ctx, jeSelect+" WHERE id=$1", id), &e); err != nil {
			return err
		}
		lines, err := loadJELines(ctx, tx, id)
		if err != nil {
			return err
		}
		e.Lines = lines
		return nil
	})
	if errors.Is(err, domain.ErrConflict) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// ---- Journal Lines ----

func (s *JournalEntryStore) AddLine(ctx context.Context, line *domain.JournalLine) error {
	line.ID = uuid.New()
	return withTenant(ctx, s.p, line.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO journal_line(id, tenant_id, entry_id, account_id, debit, credit, description, line_no)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			line.ID, line.TenantID, line.EntryID, line.AccountID,
			line.Debit, line.Credit, line.Description, line.LineNo,
		)
		return err
	})
}

type UpdateJELineInput struct {
	AccountID   uuid.UUID
	Debit       float64
	Credit      float64
	Description string
	LineNo      int
}

func (s *JournalEntryStore) UpdateLine(ctx context.Context, tid, lineID uuid.UUID, in UpdateJELineInput) (*domain.JournalLine, error) {
	var l domain.JournalLine
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE journal_line
			SET account_id=$3, debit=$4, credit=$5, description=$6, line_no=$7
			WHERE id=$1 AND tenant_id=$2`,
			lineID, tid, in.AccountID, in.Debit, in.Credit, in.Description, in.LineNo,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return tx.QueryRow(ctx, `
			SELECT id, tenant_id, entry_id, account_id, debit, credit, description, line_no
			FROM journal_line WHERE id=$1`, lineID).Scan(
			&l.ID, &l.TenantID, &l.EntryID, &l.AccountID,
			&l.Debit, &l.Credit, &l.Description, &l.LineNo,
		)
	})
	if errors.Is(err, domain.ErrNotFound) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return &l, nil
}

func (s *JournalEntryStore) DeleteLine(ctx context.Context, tid, lineID uuid.UUID) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			`DELETE FROM journal_line WHERE id=$1 AND tenant_id=$2`,
			lineID, tid,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}
