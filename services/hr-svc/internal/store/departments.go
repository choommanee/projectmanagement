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

	"github.com/pmplatform/services/hr-svc/internal/domain"
)

type DepartmentStore struct{ p *pgxpool.Pool }

func NewDepartmentStore(p *pgxpool.Pool) *DepartmentStore { return &DepartmentStore{p: p} }

const deptSelect = `
    SELECT id, tenant_id, code, name, parent_id, active, created_at, updated_at, version
    FROM department`

func scanDept(row interface{ Scan(...any) error }, d *domain.Department) error {
	return row.Scan(
		&d.ID, &d.TenantID, &d.Code, &d.Name, &d.ParentID,
		&d.Active, &d.CreatedAt, &d.UpdatedAt, &d.Version,
	)
}

func (s *DepartmentStore) Create(ctx context.Context, d *domain.Department) error {
	d.ID = uuid.New()
	d.CreatedAt = time.Now()
	d.UpdatedAt = d.CreatedAt
	d.Version = 1
	return withTenant(ctx, s.p, d.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO department(id, tenant_id, code, name, parent_id, active, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			d.ID, d.TenantID, d.Code, d.Name, d.ParentID, d.Active, d.Version,
		)
		return err
	})
}

func (s *DepartmentStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Department, error) {
	var d domain.Department
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanDept(tx.QueryRow(ctx, deptSelect+" WHERE id=$1", id), &d)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

type ListDepartmentOpts struct {
	Query  string
	Limit  int
	Offset int
}

func (s *DepartmentStore) List(ctx context.Context, tid uuid.UUID, opts ListDepartmentOpts) ([]*domain.Department, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if opts.Query != "" {
		where = append(where, fmt.Sprintf("(code ILIKE $%d OR name ILIKE $%d)", idx, idx))
		args = append(args, "%"+opts.Query+"%")
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.Department
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			deptSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY code ASC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var d domain.Department
			if err := scanDept(rows, &d); err != nil {
				return err
			}
			items = append(items, &d)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM department WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdateDepartmentInput struct {
	Name     string
	ParentID *uuid.UUID
	Active   bool
	Version  int
}

func (s *DepartmentStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdateDepartmentInput) (*domain.Department, error) {
	var d domain.Department
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE department
			SET name=$3, parent_id=$4, active=$5, updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$6`,
			id, tid, in.Name, in.ParentID, in.Active, in.Version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return scanDept(tx.QueryRow(ctx, deptSelect+" WHERE id=$1", id), &d)
	})
	if errors.Is(err, domain.ErrConflict) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func (s *DepartmentStore) Delete(ctx context.Context, tid, id uuid.UUID, version int) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			`DELETE FROM department WHERE id=$1 AND tenant_id=$2 AND version=$3`,
			id, tid, version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return nil
	})
}
