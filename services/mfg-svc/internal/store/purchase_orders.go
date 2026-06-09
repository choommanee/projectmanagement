package store

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
)

// PurchaseOrders handles PO header + line storage.
type PurchaseOrders struct{ p *pgxpool.Pool }

// NewPurchaseOrders constructs a PurchaseOrders store.
func NewPurchaseOrders(p *pgxpool.Pool) *PurchaseOrders { return &PurchaseOrders{p: p} }

func (s *PurchaseOrders) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
	tx, err := s.p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String())); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// --- PO Header ---

const poSelect = `
    SELECT id, tenant_id, po_number, supplier_id, status,
           order_date, expected_date, source_so_id, notes, created_by,
           created_at, updated_at, version
    FROM purchase_order`

func scanPO(row interface{ Scan(...any) error }, po *domain.PurchaseOrder) error {
	return row.Scan(
		&po.ID, &po.TenantID, &po.PONumber, &po.SupplierID, &po.Status,
		&po.OrderDate, &po.ExpectedDate, &po.SourceSoID, &po.Notes, &po.CreatedBy,
		&po.CreatedAt, &po.UpdatedAt, &po.Version,
	)
}

// Create inserts a new purchase order (no lines yet).
func (s *PurchaseOrders) Create(ctx context.Context, po *domain.PurchaseOrder) error {
	return s.withTenant(ctx, po.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO purchase_order(
			    id, tenant_id, po_number, supplier_id, status,
			    order_date, expected_date, source_so_id, notes, created_by, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			po.ID, po.TenantID, po.PONumber, po.SupplierID, po.Status,
			po.OrderDate, po.ExpectedDate, po.SourceSoID, po.Notes, po.CreatedBy, po.Version,
		)
		return err
	})
}

// GetByID retrieves a PO and all its lines.
func (s *PurchaseOrders) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.PurchaseOrder, error) {
	var po domain.PurchaseOrder
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		if err := scanPO(
			tx.QueryRow(ctx, poSelect+" WHERE id = $1", id),
			&po,
		); err != nil {
			return err
		}
		lines, err := listLinesInTx(ctx, tx, tid, id)
		if err != nil {
			return err
		}
		po.Lines = lines
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &po, nil
}

// ListPOOpts are optional filters for List.
type ListPOOpts struct {
	Status     string
	SupplierID *uuid.UUID
	SourceSoID *uuid.UUID
	Q          string
	Limit      int
	Offset     int
}

// List returns tenant-scoped purchase orders matching the filter options.
// Lines are NOT populated for list results (use GetByID for detail).
func (s *PurchaseOrders) List(ctx context.Context, tid uuid.UUID, opts ListPOOpts) ([]*domain.PurchaseOrder, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2

	if opts.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d::po_status", idx))
		args = append(args, opts.Status)
		idx++
	}
	if opts.SupplierID != nil {
		where = append(where, fmt.Sprintf("supplier_id = $%d", idx))
		args = append(args, *opts.SupplierID)
		idx++
	}
	if opts.SourceSoID != nil {
		where = append(where, fmt.Sprintf("source_so_id = $%d", idx))
		args = append(args, *opts.SourceSoID)
		idx++
	}
	if opts.Q != "" {
		where = append(where, fmt.Sprintf("po_number ILIKE $%d", idx))
		args = append(args, "%"+opts.Q+"%")
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var list []*domain.PurchaseOrder
	var total int
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			poSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var po domain.PurchaseOrder
			if err := scanPO(rows, &po); err != nil {
				return err
			}
			list = append(list, &po)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM purchase_order WHERE "+whereSQL, args...).Scan(&total)
	})
	return list, total, err
}

// Update applies patch fields with optimistic locking.
func (s *PurchaseOrders) Update(ctx context.Context, po *domain.PurchaseOrder) error {
	return s.withTenant(ctx, po.TenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE purchase_order
			SET supplier_id=$3, status=$4::po_status, order_date=$5,
			    expected_date=$6, source_so_id=$7, notes=$8,
			    updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$9`,
			po.ID, po.TenantID,
			po.SupplierID, po.Status, po.OrderDate,
			po.ExpectedDate, po.SourceSoID, po.Notes,
			po.Version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		po.Version++
		return nil
	})
}

// --- PO Lines ---

const lineSelect = `
    SELECT id, tenant_id, po_id, item_id, line_no,
           qty_ordered, qty_received, unit_price, uom_id, notes
    FROM po_line`

func scanLine(row interface{ Scan(...any) error }, l *domain.POLine) error {
	return row.Scan(
		&l.ID, &l.TenantID, &l.POID, &l.ItemID, &l.LineNo,
		&l.QtyOrdered, &l.QtyReceived, &l.UnitPrice, &l.UomID, &l.Notes,
	)
}

func listLinesInTx(ctx context.Context, tx pgx.Tx, tid, poID uuid.UUID) ([]domain.POLine, error) {
	rows, err := tx.Query(ctx,
		lineSelect+" WHERE po_id = $1 ORDER BY line_no", poID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var lines []domain.POLine
	for rows.Next() {
		var l domain.POLine
		if err := scanLine(rows, &l); err != nil {
			return nil, err
		}
		lines = append(lines, l)
	}
	return lines, rows.Err()
}

// ListLines returns all lines for a PO.
func (s *PurchaseOrders) ListLines(ctx context.Context, tid, poID uuid.UUID) ([]domain.POLine, error) {
	var lines []domain.POLine
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		var err error
		lines, err = listLinesInTx(ctx, tx, tid, poID)
		return err
	})
	return lines, err
}

// AddLine inserts a new line on an existing PO.
func (s *PurchaseOrders) AddLine(ctx context.Context, l *domain.POLine) error {
	return s.withTenant(ctx, l.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO po_line(id, tenant_id, po_id, item_id, line_no,
			                    qty_ordered, qty_received, unit_price, uom_id, notes)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			l.ID, l.TenantID, l.POID, l.ItemID, l.LineNo,
			l.QtyOrdered, l.QtyReceived, l.UnitPrice, l.UomID, l.Notes,
		)
		return err
	})
}

// UpdateLine patches an existing PO line.
func (s *PurchaseOrders) UpdateLine(ctx context.Context, l *domain.POLine) error {
	return s.withTenant(ctx, l.TenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE po_line
			SET item_id=$3, line_no=$4, qty_ordered=$5, qty_received=$6,
			    unit_price=$7, uom_id=$8, notes=$9
			WHERE id=$1 AND tenant_id=$2`,
			l.ID, l.TenantID,
			l.ItemID, l.LineNo, l.QtyOrdered, l.QtyReceived,
			l.UnitPrice, l.UomID, l.Notes,
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

// DeleteLine removes a single PO line.
func (s *PurchaseOrders) DeleteLine(ctx context.Context, tid, lineID uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			`DELETE FROM po_line WHERE id=$1 AND tenant_id=$2`, lineID, tid)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}
