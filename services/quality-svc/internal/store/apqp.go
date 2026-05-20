package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/quality-svc/internal/domain"
)

type APQP struct{ p *pgxpool.Pool }

func NewAPQP(p *pgxpool.Pool) *APQP { return &APQP{p: p} }

const apqpSelect = `
    SELECT id, tenant_id, item_id, work_order_id, name, phase, status,
           milestones, owner_id, target_date, created_at, updated_at, version
    FROM apqp_project`

func scanAPQP(row interface{ Scan(...any) error }, a *domain.APQPProject) error {
	return row.Scan(&a.ID, &a.TenantID, &a.ItemID, &a.WorkOrderID, &a.Name, &a.Phase, &a.Status,
		&a.Milestones, &a.OwnerID, &a.TargetDate, &a.CreatedAt, &a.UpdatedAt, &a.Version)
}

func (s *APQP) Create(ctx context.Context, a *domain.APQPProject) error {
	a.ID = uuid.New()
	a.CreatedAt = time.Now()
	a.UpdatedAt = a.CreatedAt
	a.Version = 1
	if a.Milestones == nil {
		a.Milestones = []byte("[]")
	}
	return withTenant(ctx, s.p, a.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO apqp_project(id, tenant_id, item_id, work_order_id, name, phase, status,
			                         milestones, owner_id, target_date, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			a.ID, a.TenantID, a.ItemID, a.WorkOrderID, a.Name, a.Phase, a.Status,
			a.Milestones, a.OwnerID, a.TargetDate, a.Version)
		return err
	})
}

func (s *APQP) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.APQPProject, error) {
	var a domain.APQPProject
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanAPQP(tx.QueryRow(ctx, apqpSelect+" WHERE id=$1", id), &a)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

type ListAPQPOpts struct {
	ItemID      *uuid.UUID
	WorkOrderID *uuid.UUID
	Phase       string
	Limit       int
	Offset      int
}

func (s *APQP) List(ctx context.Context, tid uuid.UUID, opts ListAPQPOpts) ([]*domain.APQPProject, int, error) {
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
	if opts.WorkOrderID != nil {
		where = append(where, fmt.Sprintf("work_order_id = $%d", idx))
		args = append(args, *opts.WorkOrderID)
		idx++
	}
	if opts.Phase != "" {
		where = append(where, fmt.Sprintf("phase = $%d", idx))
		args = append(args, opts.Phase)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.APQPProject
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			apqpSelect+" WHERE "+whereSQL+fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a domain.APQPProject
			if err := scanAPQP(rows, &a); err != nil {
				return err
			}
			items = append(items, &a)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM apqp_project WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdateAPQPInput struct {
	Name        string
	Phase       domain.APQPPhase
	Status      domain.APQPStatus
	Milestones  json.RawMessage
	TargetDate  *time.Time
	OwnerID     *uuid.UUID
	Version     int
}

func (s *APQP) Update(ctx context.Context, tid, id uuid.UUID, in UpdateAPQPInput) (*domain.APQPProject, error) {
	var a domain.APQPProject
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ms := in.Milestones
		if ms == nil {
			ms = json.RawMessage("[]")
		}
		ct, err := tx.Exec(ctx, `
			UPDATE apqp_project SET name=$3, phase=$4, status=$5, milestones=$6,
			       target_date=$7, owner_id=$8, updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$9`,
			id, tid, in.Name, in.Phase, in.Status, []byte(ms), in.TargetDate, in.OwnerID, in.Version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return scanAPQP(tx.QueryRow(ctx, apqpSelect+" WHERE id=$1", id), &a)
	})
	if errors.Is(err, domain.ErrConflict) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (s *APQP) Delete(ctx context.Context, tid, id uuid.UUID, version int) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `DELETE FROM apqp_project WHERE id=$1 AND tenant_id=$2 AND version=$3`, id, tid, version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return nil
	})
}
