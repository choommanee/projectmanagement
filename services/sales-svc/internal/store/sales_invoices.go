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

	"github.com/pmplatform/services/sales-svc/internal/domain"
)

type SalesInvoiceStore struct{ p *pgxpool.Pool }

func NewSalesInvoiceStore(p *pgxpool.Pool) *SalesInvoiceStore { return &SalesInvoiceStore{p: p} }

const invoiceSelect = `
    SELECT id, tenant_id, code, so_id, customer_id, issue_date, due_date,
           status, subtotal, tax, total, notes, created_at, updated_at, version
    FROM sales_invoice`

func scanInvoice(row interface{ Scan(...any) error }, inv *domain.SalesInvoice) error {
	return row.Scan(
		&inv.ID, &inv.TenantID, &inv.Code, &inv.SOID, &inv.CustomerID,
		&inv.IssueDate, &inv.DueDate, &inv.Status, &inv.Subtotal, &inv.Tax,
		&inv.Total, &inv.Notes, &inv.CreatedAt, &inv.UpdatedAt, &inv.Version,
	)
}

func (s *SalesInvoiceStore) Create(ctx context.Context, inv *domain.SalesInvoice) error {
	inv.ID = uuid.New()
	inv.CreatedAt = time.Now()
	inv.UpdatedAt = inv.CreatedAt
	inv.Version = 1
	if inv.Status == "" {
		inv.Status = domain.InvoiceDraft
	}
	if inv.IssueDate.IsZero() {
		inv.IssueDate = time.Now()
	}
	return withTenant(ctx, s.p, inv.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO sales_invoice(id, tenant_id, code, so_id, customer_id, issue_date,
			                          due_date, status, subtotal, tax, total, notes, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
			inv.ID, inv.TenantID, inv.Code, inv.SOID, inv.CustomerID, inv.IssueDate,
			inv.DueDate, inv.Status, inv.Subtotal, inv.Tax, inv.Total, inv.Notes, inv.Version,
		)
		return err
	})
}

func (s *SalesInvoiceStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.SalesInvoice, error) {
	var inv domain.SalesInvoice
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanInvoice(tx.QueryRow(ctx, invoiceSelect+" WHERE id=$1", id), &inv)
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
	Status     string
	CustomerID *uuid.UUID
	Limit      int
	Offset     int
}

func (s *SalesInvoiceStore) List(ctx context.Context, tid uuid.UUID, opts ListInvoiceOpts) ([]*domain.SalesInvoice, int, error) {
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
	if opts.CustomerID != nil {
		where = append(where, fmt.Sprintf("customer_id = $%d", idx))
		args = append(args, *opts.CustomerID)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.SalesInvoice
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			invoiceSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var inv domain.SalesInvoice
			if err := scanInvoice(rows, &inv); err != nil {
				return err
			}
			items = append(items, &inv)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM sales_invoice WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdateInvoiceInput struct {
	Status   domain.InvoiceStatus
	DueDate  *time.Time
	Subtotal float64
	Tax      float64
	Total    float64
	Notes    string
	Version  int
}

func (s *SalesInvoiceStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdateInvoiceInput) (*domain.SalesInvoice, error) {
	var inv domain.SalesInvoice
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE sales_invoice
			SET status=$3, due_date=$4, subtotal=$5, tax=$6, total=$7, notes=$8,
			    updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$9`,
			id, tid, in.Status, in.DueDate, in.Subtotal, in.Tax, in.Total, in.Notes, in.Version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return scanInvoice(tx.QueryRow(ctx, invoiceSelect+" WHERE id=$1", id), &inv)
	})
	if errors.Is(err, domain.ErrConflict) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return &inv, nil
}
