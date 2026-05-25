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

// WorkCenters handles work-center storage.
type WorkCenters struct{ p *pgxpool.Pool }

func NewWorkCenters(p *pgxpool.Pool) *WorkCenters { return &WorkCenters{p: p} }

func (s *WorkCenters) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

const wcSelect = `
    SELECT id, tenant_id, code, name, type, capacity_per_day_hrs, status, created_at, updated_at, version
    FROM work_center`

func scanWC(row interface{ Scan(...any) error }, wc *domain.WorkCenter) error {
	return row.Scan(&wc.ID, &wc.TenantID, &wc.Code, &wc.Name, &wc.Type,
		&wc.CapacityPerDayHrs, &wc.Status, &wc.CreatedAt, &wc.UpdatedAt, &wc.Version)
}

func (s *WorkCenters) Create(ctx context.Context, wc *domain.WorkCenter) error {
	return s.withTenant(ctx, wc.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO work_center(id, tenant_id, code, name, type, capacity_per_day_hrs, status, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			wc.ID, wc.TenantID, wc.Code, wc.Name, wc.Type, wc.CapacityPerDayHrs, wc.Status, wc.Version)
		return err
	})
}

func (s *WorkCenters) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.WorkCenter, error) {
	var wc domain.WorkCenter
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return scanWC(tx.QueryRow(ctx, wcSelect+" WHERE id = $1", id), &wc)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &wc, nil
}

func (s *WorkCenters) List(ctx context.Context, tid uuid.UUID) ([]*domain.WorkCenter, error) {
	var list []*domain.WorkCenter
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, wcSelect+" WHERE tenant_id = $1 ORDER BY code", tid)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var wc domain.WorkCenter
			if err := scanWC(rows, &wc); err != nil {
				return err
			}
			list = append(list, &wc)
		}
		return rows.Err()
	})
	return list, err
}

func (s *WorkCenters) Update(ctx context.Context, wc *domain.WorkCenter) error {
	return s.withTenant(ctx, wc.TenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE work_center SET name=$3, type=$4, capacity_per_day_hrs=$5, status=$6,
			                       updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$7`,
			wc.ID, wc.TenantID, wc.Name, wc.Type, wc.CapacityPerDayHrs, wc.Status, wc.Version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		wc.Version++
		return nil
	})
}

func (s *WorkCenters) Delete(ctx context.Context, tid, id uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `DELETE FROM work_center WHERE id=$1 AND tenant_id=$2`, id, tid)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}
