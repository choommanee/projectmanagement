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

type SalesOrderStore struct{ p *pgxpool.Pool }

func NewSalesOrderStore(p *pgxpool.Pool) *SalesOrderStore { return &SalesOrderStore{p: p} }

const soSelect = `
    SELECT id, tenant_id, so_number, customer_id, status, order_date,
           requested_date, notes, created_by, created_at, updated_at, version
    FROM sales_order`

func scanSO(row interface{ Scan(...any) error }, s *domain.SalesOrder) error {
	return row.Scan(
		&s.ID, &s.TenantID, &s.SONumber, &s.CustomerID, &s.Status,
		&s.OrderDate, &s.RequestedDate, &s.Notes, &s.CreatedBy,
		&s.CreatedAt, &s.UpdatedAt, &s.Version,
	)
}

func (s *SalesOrderStore) Create(ctx context.Context, so *domain.SalesOrder) error {
	so.ID = uuid.New()
	so.CreatedAt = time.Now()
	so.UpdatedAt = so.CreatedAt
	so.Version = 1
	return withTenant(ctx, s.p, so.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO sales_order(id, tenant_id, so_number, customer_id, status,
			                        order_date, requested_date, notes, created_by, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			so.ID, so.TenantID, so.SONumber, so.CustomerID, so.Status,
			so.OrderDate, so.RequestedDate, so.Notes, so.CreatedBy, so.Version,
		)
		return err
	})
}

func (s *SalesOrderStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.SalesOrder, error) {
	var so domain.SalesOrder
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		if err := scanSO(tx.QueryRow(ctx, soSelect+" WHERE id=$1", id), &so); err != nil {
			return err
		}
		// load lines
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, so_id, item_id, item_desc, line_no,
			       qty_ordered, qty_shipped, unit_price, notes
			FROM so_line WHERE so_id=$1 ORDER BY line_no ASC`, id)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var l domain.SOLine
			if err := rows.Scan(&l.ID, &l.TenantID, &l.SOID, &l.ItemID, &l.ItemDesc,
				&l.LineNo, &l.QtyOrdered, &l.QtyShipped, &l.UnitPrice, &l.Notes); err != nil {
				return err
			}
			so.Lines = append(so.Lines, &l)
		}
		return rows.Err()
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &so, nil
}

type ListSOOpts struct {
	Status     string
	CustomerID *uuid.UUID
	Limit      int
	Offset     int
}

func (s *SalesOrderStore) List(ctx context.Context, tid uuid.UUID, opts ListSOOpts) ([]*domain.SalesOrder, int, error) {
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

	var items []*domain.SalesOrder
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			soSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var so domain.SalesOrder
			if err := scanSO(rows, &so); err != nil {
				return err
			}
			items = append(items, &so)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM sales_order WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdateSOInput struct {
	Status        domain.SOStatus
	Notes         string
	RequestedDate *time.Time
	Version       int
}

func (s *SalesOrderStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdateSOInput) (*domain.SalesOrder, error) {
	var so domain.SalesOrder
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE sales_order
			SET status=$3, notes=$4, requested_date=$5, updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$6`,
			id, tid, in.Status, in.Notes, in.RequestedDate, in.Version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return scanSO(tx.QueryRow(ctx, soSelect+" WHERE id=$1", id), &so)
	})
	if errors.Is(err, domain.ErrConflict) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return &so, nil
}

// ---- SO Lines ----

func (s *SalesOrderStore) AddLine(ctx context.Context, line *domain.SOLine) error {
	line.ID = uuid.New()
	return withTenant(ctx, s.p, line.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO so_line(id, tenant_id, so_id, item_id, item_desc, line_no,
			                    qty_ordered, qty_shipped, unit_price, notes)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			line.ID, line.TenantID, line.SOID, line.ItemID, line.ItemDesc,
			line.LineNo, line.QtyOrdered, line.QtyShipped, line.UnitPrice, line.Notes,
		)
		return err
	})
}

type UpdateSOLineInput struct {
	ItemDesc   string
	LineNo     int
	QtyOrdered float64
	QtyShipped float64
	UnitPrice  float64
	Notes      string
}

func (s *SalesOrderStore) UpdateLine(ctx context.Context, tid, lineID uuid.UUID, in UpdateSOLineInput) (*domain.SOLine, error) {
	var l domain.SOLine
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE so_line
			SET item_desc=$3, line_no=$4, qty_ordered=$5, qty_shipped=$6,
			    unit_price=$7, notes=$8
			WHERE id=$1 AND tenant_id=$2`,
			lineID, tid, in.ItemDesc, in.LineNo, in.QtyOrdered, in.QtyShipped,
			in.UnitPrice, in.Notes,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return tx.QueryRow(ctx, `
			SELECT id, tenant_id, so_id, item_id, item_desc, line_no,
			       qty_ordered, qty_shipped, unit_price, notes
			FROM so_line WHERE id=$1`, lineID).Scan(
			&l.ID, &l.TenantID, &l.SOID, &l.ItemID, &l.ItemDesc,
			&l.LineNo, &l.QtyOrdered, &l.QtyShipped, &l.UnitPrice, &l.Notes,
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

func (s *SalesOrderStore) DeleteLine(ctx context.Context, tid, lineID uuid.UUID) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			`DELETE FROM so_line WHERE id=$1 AND tenant_id=$2`,
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
