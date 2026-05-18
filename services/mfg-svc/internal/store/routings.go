package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
)

// Routings handles routing header and operation storage.
type Routings struct{ p *pgxpool.Pool }

func NewRoutings(p *pgxpool.Pool) *Routings { return &Routings{p: p} }

func (s *Routings) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

// --- Routing Header ---

const routingHeaderSelect = `
    SELECT id, tenant_id, item_id, version, is_default, status,
           COALESCE(notes,''), created_at, updated_at
    FROM routing_header`

func scanRoutingHeader(row interface{ Scan(...any) error }, h *domain.RoutingHeader) error {
	return row.Scan(&h.ID, &h.TenantID, &h.ItemID, &h.Version, &h.IsDefault, &h.Status,
		&h.Notes, &h.CreatedAt, &h.UpdatedAt)
}

func (s *Routings) CreateHeader(ctx context.Context, h *domain.RoutingHeader) error {
	return s.withTenant(ctx, h.TenantID, func(tx pgx.Tx) error {
		var maxVer int
		_ = tx.QueryRow(ctx, `SELECT COALESCE(MAX(version),0) FROM routing_header WHERE item_id = $1`, h.ItemID).Scan(&maxVer)
		h.Version = maxVer + 1
		h.ID = uuid.New()
		_, err := tx.Exec(ctx, `
			INSERT INTO routing_header(id, tenant_id, item_id, version, is_default, status, notes)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			h.ID, h.TenantID, h.ItemID, h.Version, h.IsDefault, h.Status, h.Notes)
		return err
	})
}

func (s *Routings) GetHeaderByID(ctx context.Context, tid, id uuid.UUID) (*domain.RoutingHeader, error) {
	var h domain.RoutingHeader
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return scanRoutingHeader(tx.QueryRow(ctx, routingHeaderSelect+" WHERE id = $1", id), &h)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &h, nil
}

func (s *Routings) ListByItem(ctx context.Context, tid, itemID uuid.UUID) ([]*domain.RoutingHeader, error) {
	var list []*domain.RoutingHeader
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, routingHeaderSelect+" WHERE tenant_id = $1 AND item_id = $2 ORDER BY version", tid, itemID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var h domain.RoutingHeader
			if err := scanRoutingHeader(rows, &h); err != nil {
				return err
			}
			list = append(list, &h)
		}
		return rows.Err()
	})
	return list, err
}

func (s *Routings) UpdateHeader(ctx context.Context, h *domain.RoutingHeader) error {
	return s.withTenant(ctx, h.TenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE routing_header SET is_default=$3, status=$4, notes=$5, updated_at=now()
			WHERE id=$1 AND tenant_id=$2`,
			h.ID, h.TenantID, h.IsDefault, h.Status, h.Notes)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}

// --- Routing Operations ---

const routingOpSelect = `
    SELECT id, tenant_id, routing_id, op_no, work_center_id,
           setup_min, run_per_unit_min, COALESCE(description,'')
    FROM routing_operation`

func scanRoutingOp(row interface{ Scan(...any) error }, op *domain.RoutingOperation) error {
	return row.Scan(&op.ID, &op.TenantID, &op.RoutingID, &op.OpNo, &op.WorkCenterID,
		&op.SetupMin, &op.RunPerUnitMin, &op.Description)
}

func (s *Routings) AddOperation(ctx context.Context, op *domain.RoutingOperation) error {
	op.ID = uuid.New()
	return s.withTenant(ctx, op.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO routing_operation(id, tenant_id, routing_id, op_no, work_center_id,
			                              setup_min, run_per_unit_min, description)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			op.ID, op.TenantID, op.RoutingID, op.OpNo, op.WorkCenterID,
			op.SetupMin, op.RunPerUnitMin, op.Description)
		return err
	})
}

func (s *Routings) UpdateOperation(ctx context.Context, op *domain.RoutingOperation) error {
	return s.withTenant(ctx, op.TenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE routing_operation SET op_no=$3, work_center_id=$4, setup_min=$5,
			                             run_per_unit_min=$6, description=$7
			WHERE id=$1 AND tenant_id=$2`,
			op.ID, op.TenantID, op.OpNo, op.WorkCenterID, op.SetupMin, op.RunPerUnitMin, op.Description)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}

func (s *Routings) DeleteOperation(ctx context.Context, tid, id uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `DELETE FROM routing_operation WHERE id=$1 AND tenant_id=$2`, id, tid)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}

func (s *Routings) ListByRouting(ctx context.Context, tid, routingID uuid.UUID) ([]*domain.RoutingOperation, error) {
	var list []*domain.RoutingOperation
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, routingOpSelect+" WHERE routing_id = $1 ORDER BY op_no", routingID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var op domain.RoutingOperation
			if err := scanRoutingOp(rows, &op); err != nil {
				return err
			}
			list = append(list, &op)
		}
		return rows.Err()
	})
	return list, err
}
