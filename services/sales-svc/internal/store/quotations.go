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

type QuotationStore struct{ p *pgxpool.Pool }

func NewQuotationStore(p *pgxpool.Pool) *QuotationStore { return &QuotationStore{p: p} }

const quotationSelect = `
    SELECT id, tenant_id, code, customer_id, title, valid_until,
           status, total_amount, notes, created_at, updated_at, version
    FROM quotation`

func scanQuotation(row interface{ Scan(...any) error }, q *domain.Quotation) error {
	return row.Scan(
		&q.ID, &q.TenantID, &q.Code, &q.CustomerID, &q.Title, &q.ValidUntil,
		&q.Status, &q.TotalAmount, &q.Notes, &q.CreatedAt, &q.UpdatedAt, &q.Version,
	)
}

func (s *QuotationStore) Create(ctx context.Context, q *domain.Quotation) error {
	q.ID = uuid.New()
	q.CreatedAt = time.Now()
	q.UpdatedAt = q.CreatedAt
	q.Version = 1
	if q.Status == "" {
		q.Status = domain.QuotationDraft
	}
	return withTenant(ctx, s.p, q.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO quotation(id, tenant_id, code, customer_id, title, valid_until,
			                      status, total_amount, notes, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			q.ID, q.TenantID, q.Code, q.CustomerID, q.Title, q.ValidUntil,
			q.Status, q.TotalAmount, q.Notes, q.Version,
		)
		return err
	})
}

func (s *QuotationStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Quotation, error) {
	var q domain.Quotation
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanQuotation(tx.QueryRow(ctx, quotationSelect+" WHERE id=$1", id), &q)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &q, nil
}

type ListQuotationOpts struct {
	Status     string
	CustomerID *uuid.UUID
	Limit      int
	Offset     int
}

func (s *QuotationStore) List(ctx context.Context, tid uuid.UUID, opts ListQuotationOpts) ([]*domain.Quotation, int, error) {
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

	var items []*domain.Quotation
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			quotationSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var q domain.Quotation
			if err := scanQuotation(rows, &q); err != nil {
				return err
			}
			items = append(items, &q)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM quotation WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdateQuotationInput struct {
	Title       string
	ValidUntil  *time.Time
	Status      domain.QuotationStatus
	TotalAmount float64
	Notes       string
	Version     int
}

func (s *QuotationStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdateQuotationInput) (*domain.Quotation, error) {
	var q domain.Quotation
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE quotation
			SET title=$3, valid_until=$4, status=$5, total_amount=$6, notes=$7,
			    updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$8`,
			id, tid, in.Title, in.ValidUntil, in.Status, in.TotalAmount, in.Notes, in.Version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return scanQuotation(tx.QueryRow(ctx, quotationSelect+" WHERE id=$1", id), &q)
	})
	if errors.Is(err, domain.ErrConflict) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return &q, nil
}

// Delete hard-deletes a quotation. Returns ErrNotFound when absent.
func (s *QuotationStore) Delete(ctx context.Context, tid, id uuid.UUID) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			`DELETE FROM quotation WHERE id=$1 AND tenant_id=$2`,
			id, tid,
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
