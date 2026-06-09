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

type NCRStore struct{ p *pgxpool.Pool }

func NewNCR(p *pgxpool.Pool) *NCRStore { return &NCRStore{p: p} }

const ncrSelect = `
    SELECT id, tenant_id, item_id, lot_id, work_order_id, qty, severity, description,
           status, created_at, updated_at, version
    FROM nonconformance`

func scanNCR(row interface{ Scan(...any) error }, n *domain.Nonconformance) error {
	return row.Scan(&n.ID, &n.TenantID, &n.ItemID, &n.LotID, &n.WorkOrderID, &n.Qty, &n.Severity,
		&n.Description, &n.Status, &n.CreatedAt, &n.UpdatedAt, &n.Version)
}

func (s *NCRStore) Create(ctx context.Context, n *domain.Nonconformance) error {
	n.ID = uuid.New()
	n.CreatedAt = time.Now()
	n.UpdatedAt = n.CreatedAt
	n.Version = 1
	if n.Status == "" {
		n.Status = domain.NCRStatusOpen
	}
	return withTenant(ctx, s.p, n.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO nonconformance(id, tenant_id, item_id, lot_id, work_order_id,
			                          qty, severity, description, status, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			n.ID, n.TenantID, n.ItemID, n.LotID, n.WorkOrderID,
			n.Qty, n.Severity, n.Description, n.Status, n.Version)
		return err
	})
}

func (s *NCRStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Nonconformance, error) {
	var n domain.Nonconformance
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanNCR(tx.QueryRow(ctx, ncrSelect+" WHERE id=$1", id), &n)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &n, nil
}

type ListNCROpts struct {
	Status string
	ItemID *uuid.UUID
	Limit  int
	Offset int
}

func (s *NCRStore) List(ctx context.Context, tid uuid.UUID, opts ListNCROpts) ([]*domain.Nonconformance, int, error) {
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
	if opts.ItemID != nil {
		where = append(where, fmt.Sprintf("item_id = $%d", idx))
		args = append(args, *opts.ItemID)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.Nonconformance
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			ncrSelect+" WHERE "+whereSQL+fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var n domain.Nonconformance
			if err := scanNCR(rows, &n); err != nil {
				return err
			}
			items = append(items, &n)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM nonconformance WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdateNCRInput struct {
	Status      domain.NCRStatus
	Description string
	Qty         float64
	Severity    int
	Version     int
}

func (s *NCRStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdateNCRInput) (*domain.Nonconformance, error) {
	var n domain.Nonconformance
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE nonconformance SET status=$3, description=$4, qty=$5, severity=$6, updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$7`,
			id, tid, in.Status, in.Description, in.Qty, in.Severity, in.Version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return scanNCR(tx.QueryRow(ctx, ncrSelect+" WHERE id=$1", id), &n)
	})
	if err != nil {
		return nil, err
	}
	return &n, nil
}

// ---- CAPA ----

const capaSelect = `
    SELECT id, tenant_id, nonconformance_id, COALESCE(root_cause,''), COALESCE(action,''),
           owner_id, target_date, status, COALESCE(evidence,''), created_at, updated_at
    FROM capa`

func scanCAPA(row interface{ Scan(...any) error }, c *domain.CAPA) error {
	return row.Scan(&c.ID, &c.TenantID, &c.NonconformanceID, &c.RootCause, &c.Action,
		&c.OwnerID, &c.TargetDate, &c.Status, &c.Evidence, &c.CreatedAt, &c.UpdatedAt)
}

func (s *NCRStore) CreateCAPA(ctx context.Context, c *domain.CAPA) error {
	c.ID = uuid.New()
	c.CreatedAt = time.Now()
	c.UpdatedAt = c.CreatedAt
	if c.Status == "" {
		c.Status = domain.APQPStatusNotStarted
	}
	return withTenant(ctx, s.p, c.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO capa(id, tenant_id, nonconformance_id, root_cause, action,
			                  owner_id, target_date, status, evidence)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			c.ID, c.TenantID, c.NonconformanceID, c.RootCause, c.Action,
			c.OwnerID, c.TargetDate, c.Status, c.Evidence)
		return err
	})
}

func (s *NCRStore) GetCAPA(ctx context.Context, tid, ncrID uuid.UUID) ([]*domain.CAPA, error) {
	var list []*domain.CAPA
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, capaSelect+" WHERE nonconformance_id=$1 ORDER BY created_at", ncrID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c domain.CAPA
			if err := scanCAPA(rows, &c); err != nil {
				return err
			}
			list = append(list, &c)
		}
		return rows.Err()
	})
	return list, err
}

type UpdateCAPAInput struct {
	RootCause  string
	Action     string
	Status     domain.APQPStatus
	Evidence   string
	TargetDate *time.Time
	OwnerID    *uuid.UUID
}

func (s *NCRStore) UpdateCAPA(ctx context.Context, tid, id uuid.UUID, in UpdateCAPAInput) (*domain.CAPA, error) {
	var c domain.CAPA
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE capa SET root_cause=$3, action=$4, status=$5, evidence=$6,
			       target_date=$7, owner_id=$8, updated_at=now()
			WHERE id=$1 AND tenant_id=$2`,
			id, tid, in.RootCause, in.Action, in.Status, in.Evidence, in.TargetDate, in.OwnerID)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return scanCAPA(tx.QueryRow(ctx, capaSelect+" WHERE id=$1", id), &c)
	})
	if err != nil {
		return nil, err
	}
	return &c, nil
}
