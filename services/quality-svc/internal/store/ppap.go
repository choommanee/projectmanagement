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

	"github.com/pmplatform/services/quality-svc/internal/domain"
)

type PPAP struct{ p *pgxpool.Pool }

func NewPPAP(p *pgxpool.Pool) *PPAP { return &PPAP{p: p} }

const ppapSelect = `
    SELECT id, tenant_id, item_id, part_no, COALESCE(customer,''), level, status,
           submitted_at, decision_at, COALESCE(notes,''), created_at, updated_at, version
    FROM ppap_submission`

func scanPPAP(row interface{ Scan(...any) error }, p *domain.PPAPSubmission) error {
	return row.Scan(&p.ID, &p.TenantID, &p.ItemID, &p.PartNo, &p.Customer, &p.Level, &p.Status,
		&p.SubmittedAt, &p.DecisionAt, &p.Notes, &p.CreatedAt, &p.UpdatedAt, &p.Version)
}

// Create creates a PPAP submission and auto-seeds 18 elements in the same transaction.
func (s *PPAP) Create(ctx context.Context, sub *domain.PPAPSubmission) error {
	sub.ID = uuid.New()
	sub.CreatedAt = time.Now()
	sub.UpdatedAt = sub.CreatedAt
	sub.Version = 1
	if sub.Status == "" {
		sub.Status = domain.PPAPStatusDraft
	}

	return withTenant(ctx, s.p, sub.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO ppap_submission(id, tenant_id, item_id, part_no, customer, level, status, notes, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			sub.ID, sub.TenantID, sub.ItemID, sub.PartNo, sub.Customer, sub.Level, sub.Status, sub.Notes, sub.Version)
		if err != nil {
			return err
		}
		// Seed 18 PPAP elements in a single batch
		batch := &pgx.Batch{}
		for i, name := range domain.PPAPElementNames {
			batch.Queue(`
				INSERT INTO ppap_element(id, tenant_id, submission_id, element_no, name, status)
				VALUES ($1,$2,$3,$4,$5,'not_required')`,
				uuid.New(), sub.TenantID, sub.ID, i+1, name)
		}
		br := tx.SendBatch(ctx, batch)
		for i := 0; i < 18; i++ {
			if _, err := br.Exec(); err != nil {
				br.Close()
				return err
			}
		}
		return br.Close()
	})
}

func (s *PPAP) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.PPAPSubmission, error) {
	var p domain.PPAPSubmission
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanPPAP(tx.QueryRow(ctx, ppapSelect+" WHERE id=$1", id), &p)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

type ListPPAPOpts struct {
	ItemID *uuid.UUID
	Status string
	Limit  int
	Offset int
}

func (s *PPAP) List(ctx context.Context, tid uuid.UUID, opts ListPPAPOpts) ([]*domain.PPAPSubmission, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if opts.ItemID != nil {
		where = append(where, fmt.Sprintf("item_id = $%d", idx))
		args = append(args, *opts.ItemID)
		idx++
	}
	if opts.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, opts.Status)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.PPAPSubmission
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			ppapSelect+" WHERE "+whereSQL+fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var p domain.PPAPSubmission
			if err := scanPPAP(rows, &p); err != nil {
				return err
			}
			items = append(items, &p)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM ppap_submission WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdatePPAPInput struct {
	Status      domain.PPAPStatus
	Notes       string
	SubmittedAt *time.Time
	DecisionAt  *time.Time
	Version     int
}

func (s *PPAP) Update(ctx context.Context, tid, id uuid.UUID, in UpdatePPAPInput) (*domain.PPAPSubmission, error) {
	var sub domain.PPAPSubmission
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE ppap_submission SET status=$3, notes=$4, submitted_at=$5, decision_at=$6,
			       updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$7`,
			id, tid, in.Status, in.Notes, in.SubmittedAt, in.DecisionAt, in.Version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return scanPPAP(tx.QueryRow(ctx, ppapSelect+" WHERE id=$1", id), &sub)
	})
	if err != nil {
		return nil, err
	}
	return &sub, nil
}

func (s *PPAP) Delete(ctx context.Context, tid, id uuid.UUID, version int) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `DELETE FROM ppap_submission WHERE id=$1 AND tenant_id=$2 AND version=$3`, id, tid, version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return nil
	})
}

// ListElements returns all 18 elements for a submission.
func (s *PPAP) ListElements(ctx context.Context, tid, subID uuid.UUID) ([]*domain.PPAPElement, error) {
	var list []*domain.PPAPElement
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, submission_id, element_no, name, status,
			       COALESCE(evidence_url,''), COALESCE(notes,''), updated_at
			FROM ppap_element WHERE submission_id=$1 ORDER BY element_no`, subID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var e domain.PPAPElement
			if err := rows.Scan(&e.ID, &e.TenantID, &e.SubmissionID, &e.ElementNo, &e.Name, &e.Status,
				&e.EvidenceURL, &e.Notes, &e.UpdatedAt); err != nil {
				return err
			}
			list = append(list, &e)
		}
		return rows.Err()
	})
	return list, err
}

type UpdatePPAPElementInput struct {
	Status      domain.PPAPElementStatus
	EvidenceURL string
	Notes       string
}

func (s *PPAP) UpdateElement(ctx context.Context, tid, elemID uuid.UUID, in UpdatePPAPElementInput) (*domain.PPAPElement, error) {
	var e domain.PPAPElement
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE ppap_element SET status=$3, evidence_url=$4, notes=$5, updated_at=now()
			WHERE id=$1 AND tenant_id=$2`,
			elemID, tid, in.Status, in.EvidenceURL, in.Notes)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return tx.QueryRow(ctx, `
			SELECT id, tenant_id, submission_id, element_no, name, status,
			       COALESCE(evidence_url,''), COALESCE(notes,''), updated_at
			FROM ppap_element WHERE id=$1`, elemID).Scan(
			&e.ID, &e.TenantID, &e.SubmissionID, &e.ElementNo, &e.Name, &e.Status,
			&e.EvidenceURL, &e.Notes, &e.UpdatedAt)
	})
	if err != nil {
		return nil, err
	}
	return &e, nil
}
