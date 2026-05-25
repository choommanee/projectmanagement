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

// WorkOrders handles work-order, lot, and related storage.
type WorkOrders struct {
	p    *pgxpool.Pool
	boms *BOMs
}

func NewWorkOrders(p *pgxpool.Pool, boms *BOMs) *WorkOrders { return &WorkOrders{p: p, boms: boms} }

func (s *WorkOrders) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

// --- Work Orders ---

const woSelect = `
    SELECT id, tenant_id, code, item_id, qty, qty_completed, status, priority,
           due_date, work_center_id, start_at, end_at,
           routing_header_id, bom_header_id, COALESCE(notes,''),
           created_at, updated_at, version
    FROM work_order`

func scanWO(row interface{ Scan(...any) error }, wo *domain.WorkOrder) error {
	return row.Scan(&wo.ID, &wo.TenantID, &wo.Code, &wo.ItemID, &wo.Qty, &wo.QtyCompleted,
		&wo.Status, &wo.Priority, &wo.DueDate, &wo.WorkCenterID, &wo.StartAt, &wo.EndAt,
		&wo.RoutingHeaderID, &wo.BOMHeaderID, &wo.Notes,
		&wo.CreatedAt, &wo.UpdatedAt, &wo.Version)
}

func (s *WorkOrders) Create(ctx context.Context, wo *domain.WorkOrder) error {
	return s.withTenant(ctx, wo.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO work_order(id, tenant_id, code, item_id, qty, status, priority,
			                       due_date, work_center_id, routing_header_id, bom_header_id, notes, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
			wo.ID, wo.TenantID, wo.Code, wo.ItemID, wo.Qty, wo.Status, wo.Priority,
			wo.DueDate, wo.WorkCenterID, wo.RoutingHeaderID, wo.BOMHeaderID, wo.Notes, wo.Version)
		return err
	})
}

func (s *WorkOrders) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.WorkOrder, error) {
	var wo domain.WorkOrder
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return scanWO(tx.QueryRow(ctx, woSelect+" WHERE id = $1 AND deleted_at IS NULL", id), &wo)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &wo, nil
}

type ListWOOpts struct {
	Status string
	Q      string
	ItemID *uuid.UUID
	Limit  int
	Offset int
}

func (s *WorkOrders) List(ctx context.Context, tid uuid.UUID, opts ListWOOpts) ([]*domain.WorkOrder, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1", "deleted_at IS NULL"}
	args := []any{tid}
	idx := 2

	if opts.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, opts.Status)
		idx++
	}
	if opts.Q != "" {
		where = append(where, fmt.Sprintf("(code ILIKE $%d)", idx))
		args = append(args, "%"+opts.Q+"%")
		idx++
	}
	if opts.ItemID != nil {
		where = append(where, fmt.Sprintf("item_id = $%d", idx))
		args = append(args, *opts.ItemID)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.WorkOrder
	var total int
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			woSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var wo domain.WorkOrder
			if err := scanWO(rows, &wo); err != nil {
				return err
			}
			items = append(items, &wo)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM work_order WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

func (s *WorkOrders) Update(ctx context.Context, wo *domain.WorkOrder) error {
	return s.withTenant(ctx, wo.TenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE work_order SET status=$3, priority=$4, due_date=$5, notes=$6,
			                      updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$7 AND deleted_at IS NULL`,
			wo.ID, wo.TenantID, wo.Status, wo.Priority, wo.DueDate, wo.Notes, wo.Version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		wo.Version++
		return nil
	})
}

func (s *WorkOrders) SoftDelete(ctx context.Context, tid, id uuid.UUID, version int) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE work_order SET deleted_at=now(), updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$3 AND deleted_at IS NULL`, id, tid, version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return nil
	})
}

// ReleaseWorkOrder atomically:
// 1. Verifies WO is 'planned'
// 2. Snapshots operations from active routing
// 3. Explodes BOM and snapshots material requirements
// 4. Updates WO status → 'released'
func (s *WorkOrders) ReleaseWorkOrder(ctx context.Context, tid, woID uuid.UUID, currentVersion int) (*domain.WorkOrder, error) {
	tx, err := s.p.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String())); err != nil {
		return nil, err
	}

	// 1. Fetch and verify WO
	var wo domain.WorkOrder
	if err := scanWO(tx.QueryRow(ctx, woSelect+" WHERE id = $1 AND deleted_at IS NULL", woID), &wo); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	if wo.Status != domain.WOStatusPlanned {
		return nil, fmt.Errorf("%w: work order must be in 'planned' status to release", domain.ErrInvalidInput)
	}
	if wo.Version != currentVersion {
		return nil, domain.ErrConflict
	}

	// 2. Find active default routing for item
	var routingID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT id FROM routing_header
		WHERE item_id = $1 AND status = 'active' AND is_default = true
		LIMIT 1`, wo.ItemID).Scan(&routingID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	if !errors.Is(err, pgx.ErrNoRows) {
		// Snapshot routing operations
		opRows, err := tx.Query(ctx, `
			SELECT id, tenant_id, routing_id, op_no, work_center_id, setup_min, run_per_unit_min, COALESCE(description,'')
			FROM routing_operation WHERE routing_id = $1 ORDER BY op_no`, routingID)
		if err != nil {
			return nil, err
		}
		var ops []domain.RoutingOperation
		for opRows.Next() {
			var op domain.RoutingOperation
			if err := opRows.Scan(&op.ID, &op.TenantID, &op.RoutingID, &op.OpNo, &op.WorkCenterID,
				&op.SetupMin, &op.RunPerUnitMin, &op.Description); err != nil {
				opRows.Close()
				return nil, err
			}
			ops = append(ops, op)
		}
		opRows.Close()
		if opRows.Err() != nil {
			return nil, opRows.Err()
		}

		for _, op := range ops {
			_, err := tx.Exec(ctx, `
				INSERT INTO work_order_operation(id, tenant_id, work_order_id, op_no, work_center_id,
				                                 setup_min, run_per_unit_min, description)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
				uuid.New(), tid, woID, op.OpNo, op.WorkCenterID, op.SetupMin, op.RunPerUnitMin, op.Description)
			if err != nil {
				return nil, err
			}
		}
		wo.RoutingHeaderID = &routingID
	}

	// 3. Find active default BOM for item and explode
	var bomHeaderID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT id FROM bom_header
		WHERE item_id = $1 AND status = 'active' AND is_default = true
		LIMIT 1`, wo.ItemID).Scan(&bomHeaderID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	if !errors.Is(err, pgx.ErrNoRows) {
		// Explode BOM using recursive CTE - same transaction
		explodeRows, err := tx.Query(ctx, `
WITH RECURSIVE explode AS (
  SELECT bh.id AS header_id, bl.child_item_id AS item_id, bl.qty * $1 AS req_qty, 1 AS lvl
  FROM bom_header bh
  JOIN bom_line bl ON bl.header_id = bh.id
  WHERE bh.item_id = $2 AND bh.status = 'active' AND bh.is_default = true
  UNION ALL
  SELECT bh2.id, bl2.child_item_id, bl2.qty * e.req_qty, e.lvl + 1
  FROM explode e
  JOIN bom_header bh2 ON bh2.item_id = e.item_id AND bh2.status = 'active' AND bh2.is_default = true
  JOIN bom_line bl2 ON bl2.header_id = bh2.id
  WHERE e.lvl < 10
)
SELECT e.item_id, e.req_qty, i.uom_id, i.type
FROM explode e
JOIN item i ON i.id = e.item_id
ORDER BY e.lvl, i.code`, wo.Qty, wo.ItemID)
		if err != nil {
			return nil, err
		}

		type matRow struct {
			itemID uuid.UUID
			qty    float64
			uomID  uuid.UUID
			itype  string
		}
		var mats []matRow
		for explodeRows.Next() {
			var m matRow
			if err := explodeRows.Scan(&m.itemID, &m.qty, &m.uomID, &m.itype); err != nil {
				explodeRows.Close()
				return nil, err
			}
			mats = append(mats, m)
		}
		explodeRows.Close()
		if explodeRows.Err() != nil {
			return nil, explodeRows.Err()
		}

		// Insert materials (non-assembly leaf items)
		for _, m := range mats {
			if m.itype == "assembly" {
				continue
			}
			_, err := tx.Exec(ctx, `
				INSERT INTO work_order_material(id, tenant_id, work_order_id, item_id, qty_required, uom_id)
				VALUES ($1,$2,$3,$4,$5,$6)`,
				uuid.New(), tid, woID, m.itemID, m.qty, m.uomID)
			if err != nil {
				return nil, err
			}
		}
		wo.BOMHeaderID = &bomHeaderID
	}

	// 4. Update WO status
	ct, err := tx.Exec(ctx, `
		UPDATE work_order SET status='released', routing_header_id=$2, bom_header_id=$3,
		                       updated_at=now(), version=version+1
		WHERE id=$1 AND version=$4`,
		woID, wo.RoutingHeaderID, wo.BOMHeaderID, currentVersion)
	if err != nil {
		return nil, err
	}
	if ct.RowsAffected() == 0 {
		return nil, domain.ErrConflict
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	wo.Status = domain.WOStatusReleased
	wo.Version = currentVersion + 1
	return &wo, nil
}

// --- Work Order Operations ---

func (s *WorkOrders) ListOperations(ctx context.Context, tid, woID uuid.UUID) ([]*domain.WorkOrderOperation, error) {
	var list []*domain.WorkOrderOperation
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, work_order_id, op_no, work_center_id,
			       setup_min, run_per_unit_min, COALESCE(description,''), qty_done, status
			FROM work_order_operation WHERE work_order_id = $1 ORDER BY op_no`, woID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var op domain.WorkOrderOperation
			if err := rows.Scan(&op.ID, &op.TenantID, &op.WorkOrderID, &op.OpNo, &op.WorkCenterID,
				&op.SetupMin, &op.RunPerUnitMin, &op.Description, &op.QtyDone, &op.Status); err != nil {
				return err
			}
			list = append(list, &op)
		}
		return rows.Err()
	})
	return list, err
}

// --- Work Order Materials ---

func (s *WorkOrders) ListMaterials(ctx context.Context, tid, woID uuid.UUID) ([]*domain.WorkOrderMaterial, error) {
	var list []*domain.WorkOrderMaterial
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, work_order_id, item_id, qty_required, qty_issued, uom_id
			FROM work_order_material WHERE work_order_id = $1`, woID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var m domain.WorkOrderMaterial
			if err := rows.Scan(&m.ID, &m.TenantID, &m.WorkOrderID, &m.ItemID,
				&m.QtyRequired, &m.QtyIssued, &m.UomID); err != nil {
				return err
			}
			list = append(list, &m)
		}
		return rows.Err()
	})
	return list, err
}

// --- Lots ---

func (s *WorkOrders) CreateLot(ctx context.Context, lot *domain.Lot) error {
	lot.ID = uuid.New()
	return s.withTenant(ctx, lot.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO lot(id, tenant_id, item_id, lot_no, qty_on_hand, status, source_wo_id)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			lot.ID, lot.TenantID, lot.ItemID, lot.LotNo, lot.QtyOnHand, lot.Status, lot.SourceWOID)
		return err
	})
}

func (s *WorkOrders) ListLotsByItem(ctx context.Context, tid, itemID uuid.UUID) ([]*domain.Lot, error) {
	var list []*domain.Lot
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, item_id, lot_no, qty_on_hand, status, source_wo_id, created_at
			FROM lot WHERE item_id = $1 ORDER BY created_at DESC`, itemID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var l domain.Lot
			if err := rows.Scan(&l.ID, &l.TenantID, &l.ItemID, &l.LotNo, &l.QtyOnHand,
				&l.Status, &l.SourceWOID, &l.CreatedAt); err != nil {
				return err
			}
			list = append(list, &l)
		}
		return rows.Err()
	})
	return list, err
}

func (s *WorkOrders) UpdateLotStatus(ctx context.Context, tid, id uuid.UUID, status domain.LotStatus) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `UPDATE lot SET status=$3 WHERE id=$1 AND tenant_id=$2`, id, tid, status)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}

func (s *WorkOrders) DeleteLot(ctx context.Context, tid, id uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `DELETE FROM lot WHERE id=$1 AND tenant_id=$2`, id, tid)
		return err
	})
}

// ListActiveWorkOrdersForMRP returns planned/released WOs with item IDs and due dates.
type WOForMRP struct {
	ID      uuid.UUID
	ItemID  uuid.UUID
	ItemCode string
	Qty     float64
	DueDate *string // date string YYYY-MM-DD or nil
}

func (s *WorkOrders) ListForMRP(ctx context.Context, tid uuid.UUID) ([]WOForMRP, error) {
	var list []WOForMRP
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT wo.id, wo.item_id, i.code, wo.qty,
			       to_char(wo.due_date, 'YYYY-MM-DD')
			FROM work_order wo
			JOIN item i ON i.id = wo.item_id
			WHERE wo.tenant_id = $1
			  AND wo.status IN ('planned','released')
			  AND wo.deleted_at IS NULL`, tid)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var w WOForMRP
			if err := rows.Scan(&w.ID, &w.ItemID, &w.ItemCode, &w.Qty, &w.DueDate); err != nil {
				return err
			}
			list = append(list, w)
		}
		return rows.Err()
	})
	return list, err
}
