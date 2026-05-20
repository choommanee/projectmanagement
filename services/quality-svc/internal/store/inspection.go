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

type InspectionStore struct{ p *pgxpool.Pool }

func NewInspection(p *pgxpool.Pool) *InspectionStore { return &InspectionStore{p: p} }

const inspectSelect = `
    SELECT id, tenant_id, work_order_id, item_id, lot_id, inspected_at,
           COALESCE(inspector,''), result, measurements, COALESCE(notes,'')
    FROM inspection`

func scanInspection(row interface{ Scan(...any) error }, i *domain.Inspection) error {
	return row.Scan(&i.ID, &i.TenantID, &i.WorkOrderID, &i.ItemID, &i.LotID, &i.InspectedAt,
		&i.Inspector, &i.Result, &i.Measurements, &i.Notes)
}

func (s *InspectionStore) Create(ctx context.Context, i *domain.Inspection) error {
	i.ID = uuid.New()
	if i.InspectedAt.IsZero() {
		i.InspectedAt = time.Now()
	}
	if i.Result == "" {
		i.Result = domain.InspectionPass
	}
	if i.Measurements == nil {
		i.Measurements = []byte("[]")
	}
	return withTenant(ctx, s.p, i.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO inspection(id, tenant_id, work_order_id, item_id, lot_id, inspected_at,
			                       inspector, result, measurements, notes)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			i.ID, i.TenantID, i.WorkOrderID, i.ItemID, i.LotID, i.InspectedAt,
			i.Inspector, i.Result, i.Measurements, i.Notes)
		return err
	})
}

func (s *InspectionStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Inspection, error) {
	var i domain.Inspection
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanInspection(tx.QueryRow(ctx, inspectSelect+" WHERE id=$1", id), &i)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &i, nil
}

type ListInspectionOpts struct {
	WorkOrderID *uuid.UUID
	ItemID      *uuid.UUID
	Result      string
	Limit       int
	Offset      int
}

func (s *InspectionStore) List(ctx context.Context, tid uuid.UUID, opts ListInspectionOpts) ([]*domain.Inspection, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if opts.WorkOrderID != nil {
		where = append(where, fmt.Sprintf("work_order_id = $%d", idx))
		args = append(args, *opts.WorkOrderID)
		idx++
	}
	if opts.ItemID != nil {
		where = append(where, fmt.Sprintf("item_id = $%d", idx))
		args = append(args, *opts.ItemID)
		idx++
	}
	if opts.Result != "" {
		where = append(where, fmt.Sprintf("result = $%d", idx))
		args = append(args, opts.Result)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.Inspection
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			inspectSelect+" WHERE "+whereSQL+fmt.Sprintf(" ORDER BY inspected_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var i domain.Inspection
			if err := scanInspection(rows, &i); err != nil {
				return err
			}
			items = append(items, &i)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM inspection WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}
