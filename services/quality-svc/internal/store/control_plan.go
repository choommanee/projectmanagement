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

type ControlPlanStore struct{ p *pgxpool.Pool }

func NewControlPlan(p *pgxpool.Pool) *ControlPlanStore { return &ControlPlanStore{p: p} }

const cpSelect = `
    SELECT id, tenant_id, item_id, name, status, version, COALESCE(notes,''), created_at, updated_at
    FROM control_plan`

func scanCP(row interface{ Scan(...any) error }, c *domain.ControlPlan) error {
	return row.Scan(&c.ID, &c.TenantID, &c.ItemID, &c.Name, &c.Status, &c.Version, &c.Notes, &c.CreatedAt, &c.UpdatedAt)
}

func (s *ControlPlanStore) Create(ctx context.Context, c *domain.ControlPlan) error {
	c.ID = uuid.New()
	c.CreatedAt = time.Now()
	c.UpdatedAt = c.CreatedAt
	c.Version = 1
	if c.Status == "" {
		c.Status = domain.APQPStatusNotStarted
	}
	return withTenant(ctx, s.p, c.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO control_plan(id, tenant_id, item_id, name, status, notes, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			c.ID, c.TenantID, c.ItemID, c.Name, c.Status, c.Notes, c.Version)
		return err
	})
}

func (s *ControlPlanStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.ControlPlan, error) {
	var c domain.ControlPlan
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanCP(tx.QueryRow(ctx, cpSelect+" WHERE id=$1", id), &c)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

type ListCPOpts struct {
	ItemID *uuid.UUID
	Limit  int
	Offset int
}

func (s *ControlPlanStore) List(ctx context.Context, tid uuid.UUID, opts ListCPOpts) ([]*domain.ControlPlan, int, error) {
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
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.ControlPlan
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			cpSelect+" WHERE "+whereSQL+fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c domain.ControlPlan
			if err := scanCP(rows, &c); err != nil {
				return err
			}
			items = append(items, &c)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM control_plan WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdateCPInput struct {
	Name    string
	Status  domain.APQPStatus
	Notes   string
	Version int
}

func (s *ControlPlanStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdateCPInput) (*domain.ControlPlan, error) {
	var c domain.ControlPlan
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE control_plan SET name=$3, status=$4, notes=$5, updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$6`,
			id, tid, in.Name, in.Status, in.Notes, in.Version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return scanCP(tx.QueryRow(ctx, cpSelect+" WHERE id=$1", id), &c)
	})
	if err != nil {
		return nil, err
	}
	return &c, nil
}

const cpcSelect = `
    SELECT id, tenant_id, control_plan_id, no, characteristic, COALESCE(spec,''),
           COALESCE(sample_size,''), COALESCE(sample_freq,''), COALESCE(measurement_method,''),
           COALESCE(reaction_plan,''), sort_order
    FROM control_plan_characteristic`

func scanCPC(row interface{ Scan(...any) error }, c *domain.ControlPlanCharacteristic) error {
	return row.Scan(&c.ID, &c.TenantID, &c.ControlPlanID, &c.No, &c.Characteristic, &c.Spec,
		&c.SampleSize, &c.SampleFreq, &c.MeasurementMethod, &c.ReactionPlan, &c.SortOrder)
}

func (s *ControlPlanStore) AddCharacteristic(ctx context.Context, c *domain.ControlPlanCharacteristic) error {
	c.ID = uuid.New()
	return withTenant(ctx, s.p, c.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO control_plan_characteristic(id, tenant_id, control_plan_id, no, characteristic,
			                                         spec, sample_size, sample_freq, measurement_method,
			                                         reaction_plan, sort_order)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			c.ID, c.TenantID, c.ControlPlanID, c.No, c.Characteristic,
			c.Spec, c.SampleSize, c.SampleFreq, c.MeasurementMethod, c.ReactionPlan, c.SortOrder)
		return err
	})
}

func (s *ControlPlanStore) ListCharacteristics(ctx context.Context, tid, cpID uuid.UUID) ([]*domain.ControlPlanCharacteristic, error) {
	var list []*domain.ControlPlanCharacteristic
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, cpcSelect+" WHERE control_plan_id=$1 ORDER BY sort_order, no", cpID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c domain.ControlPlanCharacteristic
			if err := scanCPC(rows, &c); err != nil {
				return err
			}
			list = append(list, &c)
		}
		return rows.Err()
	})
	return list, err
}

type UpdateCPCInput struct {
	No                int
	Characteristic    string
	Spec              string
	SampleSize        string
	SampleFreq        string
	MeasurementMethod string
	ReactionPlan      string
	SortOrder         int
}

func (s *ControlPlanStore) UpdateCharacteristic(ctx context.Context, tid, id uuid.UUID, in UpdateCPCInput) (*domain.ControlPlanCharacteristic, error) {
	var c domain.ControlPlanCharacteristic
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE control_plan_characteristic SET no=$3, characteristic=$4, spec=$5,
			       sample_size=$6, sample_freq=$7, measurement_method=$8, reaction_plan=$9, sort_order=$10
			WHERE id=$1 AND tenant_id=$2`,
			id, tid, in.No, in.Characteristic, in.Spec, in.SampleSize, in.SampleFreq,
			in.MeasurementMethod, in.ReactionPlan, in.SortOrder)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return scanCPC(tx.QueryRow(ctx, cpcSelect+" WHERE id=$1", id), &c)
	})
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *ControlPlanStore) DeleteCharacteristic(ctx context.Context, tid, id uuid.UUID) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `DELETE FROM control_plan_characteristic WHERE id=$1 AND tenant_id=$2`, id, tid)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}
