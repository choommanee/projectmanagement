package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/reports-svc/internal/domain"
)

type Dashboards struct{ p *pgxpool.Pool }

func NewDashboards(p *pgxpool.Pool) *Dashboards { return &Dashboards{p: p} }

func (s *Dashboards) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
	tx, err := s.p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String())); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type ListDashboardsOpts struct {
	Visibility string
	Limit      int
	Offset     int
}

func (s *Dashboards) List(ctx context.Context, tid uuid.UUID, opts ListDashboardsOpts) ([]*domain.DashboardFull, int, error) {
	if opts.Limit <= 0 || opts.Limit > 200 {
		opts.Limit = 50
	}

	where := "tenant_id = $1"
	args := []any{tid}
	idx := 2

	if opts.Visibility != "" {
		where += fmt.Sprintf(" AND visibility = $%d::dashboard_visibility", idx)
		args = append(args, opts.Visibility)
		idx++
	}

	var items []*domain.DashboardFull
	var total int

	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		query := fmt.Sprintf(
			`SELECT id, tenant_id, owner_id, name, COALESCE(description,''), visibility, layout, widgets, is_pinned, created_at, updated_at, version
			FROM dashboard WHERE %s ORDER BY is_pinned DESC, updated_at DESC LIMIT $%d OFFSET $%d`,
			where, idx, idx+1,
		)
		rows, err := tx.Query(ctx, query, append(args, opts.Limit, opts.Offset)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			d := &domain.DashboardFull{}
			var layout, widgets []byte
			if err := rows.Scan(&d.ID, &d.TenantID, &d.OwnerID, &d.Name, &d.Description,
				&d.Visibility, &layout, &widgets, &d.IsPinned, &d.CreatedAt, &d.UpdatedAt, &d.Version); err != nil {
				return err
			}
			d.Layout = domain.RawJSON(layout)
			d.Widgets = domain.RawJSON(widgets)
			items = append(items, d)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, fmt.Sprintf("SELECT count(*) FROM dashboard WHERE %s", where), args...).Scan(&total)
	})
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (s *Dashboards) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.DashboardFull, error) {
	var d domain.DashboardFull
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		var layout, widgets []byte
		if err := tx.QueryRow(ctx,
			`SELECT id, tenant_id, owner_id, name, COALESCE(description,''), visibility, layout, widgets, is_pinned, created_at, updated_at, version
			FROM dashboard WHERE id = $1 AND tenant_id = $2`,
			id, tid,
		).Scan(&d.ID, &d.TenantID, &d.OwnerID, &d.Name, &d.Description,
			&d.Visibility, &layout, &widgets, &d.IsPinned, &d.CreatedAt, &d.UpdatedAt, &d.Version); err != nil {
			return err
		}
		d.Layout = domain.RawJSON(layout)
		d.Widgets = domain.RawJSON(widgets)
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	return &d, err
}

type CreateDashboardInput struct {
	TenantID    uuid.UUID
	OwnerID     *uuid.UUID
	Name        string
	Description string
	Visibility  domain.Visibility
	Layout      []byte
	Widgets     []byte
	IsPinned    bool
}

func (s *Dashboards) Create(ctx context.Context, in CreateDashboardInput) (*domain.DashboardFull, error) {
	if in.Visibility == "" {
		in.Visibility = domain.VisPrivate
	}
	if in.Layout == nil {
		in.Layout = []byte("[]")
	}
	if in.Widgets == nil {
		in.Widgets = []byte("[]")
	}

	var d domain.DashboardFull
	err := s.withTenant(ctx, in.TenantID, func(tx pgx.Tx) error {
		var layout, widgets []byte
		if err := tx.QueryRow(ctx,
			`INSERT INTO dashboard(tenant_id, owner_id, name, description, visibility, layout, widgets, is_pinned)
			VALUES ($1,$2,$3,$4,$5::dashboard_visibility,$6::jsonb,$7::jsonb,$8)
			RETURNING id, tenant_id, owner_id, name, COALESCE(description,''), visibility, layout, widgets, is_pinned, created_at, updated_at, version`,
			in.TenantID, in.OwnerID, in.Name, in.Description, string(in.Visibility), string(in.Layout), string(in.Widgets), in.IsPinned,
		).Scan(&d.ID, &d.TenantID, &d.OwnerID, &d.Name, &d.Description,
			&d.Visibility, &layout, &widgets, &d.IsPinned, &d.CreatedAt, &d.UpdatedAt, &d.Version); err != nil {
			return err
		}
		d.Layout = domain.RawJSON(layout)
		d.Widgets = domain.RawJSON(widgets)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &d, nil
}

type UpdateDashboardInput struct {
	TenantID    uuid.UUID
	ID          uuid.UUID
	Name        *string
	Description *string
	Visibility  *domain.Visibility
	Layout      []byte
	Widgets     []byte
	IsPinned    *bool
	Version     int
}

func (s *Dashboards) Update(ctx context.Context, in UpdateDashboardInput) (*domain.DashboardFull, error) {
	var d domain.DashboardFull
	err := s.withTenant(ctx, in.TenantID, func(tx pgx.Tx) error {
		// Fetch current
		var layout, widgets []byte
		var cur domain.DashboardFull
		if err := tx.QueryRow(ctx,
			`SELECT id, tenant_id, owner_id, name, COALESCE(description,''), visibility, layout, widgets, is_pinned, created_at, updated_at, version
			FROM dashboard WHERE id = $1 AND tenant_id = $2`,
			in.ID, in.TenantID,
		).Scan(&cur.ID, &cur.TenantID, &cur.OwnerID, &cur.Name, &cur.Description,
			&cur.Visibility, &layout, &widgets, &cur.IsPinned, &cur.CreatedAt, &cur.UpdatedAt, &cur.Version); err != nil {
			return err
		}
		if cur.Version != in.Version {
			return domain.ErrConflict
		}

		// Apply patch
		if in.Name != nil {
			cur.Name = *in.Name
		}
		if in.Description != nil {
			cur.Description = *in.Description
		}
		if in.Visibility != nil {
			cur.Visibility = *in.Visibility
		}
		if in.Layout != nil {
			layout = in.Layout
		}
		if in.Widgets != nil {
			widgets = in.Widgets
		}
		if in.IsPinned != nil {
			cur.IsPinned = *in.IsPinned
		}

		var newLayout, newWidgets []byte
		if err := tx.QueryRow(ctx,
			`UPDATE dashboard SET name=$3, description=$4, visibility=$5::dashboard_visibility,
			layout=$6::jsonb, widgets=$7::jsonb, is_pinned=$8, updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$9
			RETURNING id, tenant_id, owner_id, name, COALESCE(description,''), visibility, layout, widgets, is_pinned, created_at, updated_at, version`,
			in.ID, in.TenantID, cur.Name, cur.Description, string(cur.Visibility),
			string(layout), string(widgets), cur.IsPinned, in.Version,
		).Scan(&d.ID, &d.TenantID, &d.OwnerID, &d.Name, &d.Description,
			&d.Visibility, &newLayout, &newWidgets, &d.IsPinned, &d.CreatedAt, &d.UpdatedAt, &d.Version); err != nil {
			return err
		}
		d.Layout = domain.RawJSON(newLayout)
		d.Widgets = domain.RawJSON(newWidgets)
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if errors.Is(err, domain.ErrConflict) {
		return nil, domain.ErrConflict
	}
	return &d, err
}

func (s *Dashboards) Delete(ctx context.Context, tid, id uuid.UUID, version int) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			`DELETE FROM dashboard WHERE id=$1 AND tenant_id=$2 AND version=$3`,
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
