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

type InvoiceStore struct{ p *pgxpool.Pool }

func NewInvoiceStore(p *pgxpool.Pool) *InvoiceStore { return &InvoiceStore{p: p} }

const invSelect = `
    SELECT id, tenant_id, inv_no, inv_type, counterparty_id, amount, currency,
           status, issue_date, due_date, paid_at, ref_so_id, ref_po_id,
           notes, created_by, created_at, updated_at, version
    FROM invoice`

func scanInvoice(row interface{ Scan(...any) error }, inv *domain.Invoice) error {
	return row.Scan(
		&inv.ID, &inv.TenantID, &inv.InvNo, &inv.InvType, &inv.CounterpartyID,
		&inv.Amount, &inv.Currency, &inv.Status, &inv.IssueDate, &inv.DueDate,
		&inv.PaidAt, &inv.RefSOID, &inv.RefPOID, &inv.Notes,
		&inv.CreatedBy, &inv.CreatedAt, &inv.UpdatedAt, &inv.Version,
	)
}

func (s *InvoiceStore) Create(ctx context.Context, inv *domain.Invoice) error {
	inv.ID = uuid.New()
	inv.CreatedAt = time.Now()
	inv.UpdatedAt = inv.CreatedAt
	inv.Version = 1
	if inv.Status == "" {
		inv.Status = domain.InvStatusDraft
	}
	return withTenant(ctx, s.p, inv.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO invoice(id, tenant_id, inv_no, inv_type, counterparty_id, amount, currency,
			                    status, issue_date, due_date, ref_so_id, ref_po_id, notes, created_by, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
			inv.ID, inv.TenantID, inv.InvNo, inv.InvType, inv.CounterpartyID,
			inv.Amount, inv.Currency, inv.Status, inv.IssueDate, inv.DueDate,
			inv.RefSOID, inv.RefPOID, inv.Notes, inv.CreatedBy, inv.Version,
		)
		return err
	})
}

func (s *InvoiceStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Invoice, error) {
	var inv domain.Invoice
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanInvoice(tx.QueryRow(ctx, invSelect+" WHERE id=$1", id), &inv)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &inv, nil
}

type ListInvoiceOpts struct {
	InvType string
	Status  string
	Limit   int
	Offset  int
}

func (s *InvoiceStore) List(ctx context.Context, tid uuid.UUID, opts ListInvoiceOpts) ([]*domain.Invoice, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if opts.InvType != "" {
		where = append(where, fmt.Sprintf("inv_type = $%d", idx))
		args = append(args, opts.InvType)
		idx++
	}
	if opts.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, opts.Status)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.Invoice
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			invSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY issue_date DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var inv domain.Invoice
			if err := scanInvoice(rows, &inv); err != nil {
				return err
			}
			items = append(items, &inv)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM invoice WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdateInvoiceInput struct {
	Status  domain.InvStatus
	PaidAt  *time.Time
	Notes   string
	Version int
}

func (s *InvoiceStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdateInvoiceInput) (*domain.Invoice, error) {
	var inv domain.Invoice
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE invoice
			SET status=$3, paid_at=$4, notes=$5, updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$6`,
			id, tid, in.Status, in.PaidAt, in.Notes, in.Version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return scanInvoice(tx.QueryRow(ctx, invSelect+" WHERE id=$1", id), &inv)
	})
	if errors.Is(err, domain.ErrConflict) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return &inv, nil
}

func (s *InvoiceStore) Delete(ctx context.Context, tid, id uuid.UUID, version int) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			`DELETE FROM invoice WHERE id=$1 AND tenant_id=$2 AND version=$3`,
			id, tid, version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return nil
	})
}
