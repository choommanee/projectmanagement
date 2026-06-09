package store

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/document-svc/internal/domain"
)

type Workspaces struct{ p *pgxpool.Pool }

func NewWorkspaces(p *pgxpool.Pool) *Workspaces { return &Workspaces{p: p} }

func (s *Workspaces) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

// EnsureForProject upserts a workspace for (project_id, kind) and returns it.
func (s *Workspaces) EnsureForProject(ctx context.Context, tid, projectID uuid.UUID, kind domain.WorkspaceKind, name string) (*domain.Workspace, error) {
	var ws domain.Workspace
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO workspace(id, tenant_id, project_id, kind, name)
			VALUES ($1,$2,$3,$4,$5)
			ON CONFLICT (project_id, kind) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
			RETURNING id, tenant_id, project_id, kind, name, created_at, updated_at`,
			uuid.New(), tid, projectID, string(kind), name,
		).Scan(&ws.ID, &ws.TenantID, &ws.ProjectID, &ws.Kind, &ws.Name, &ws.CreatedAt, &ws.UpdatedAt)
	})
	if err != nil {
		return nil, err
	}
	return &ws, nil
}

// GetForProject fetches a single workspace by project+kind.
func (s *Workspaces) GetForProject(ctx context.Context, tid, projectID uuid.UUID, kind domain.WorkspaceKind) (*domain.Workspace, error) {
	var ws domain.Workspace
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT id, tenant_id, project_id, kind, name, created_at, updated_at
			FROM workspace
			WHERE tenant_id=$1 AND project_id=$2 AND kind=$3`,
			tid, projectID, string(kind),
		).Scan(&ws.ID, &ws.TenantID, &ws.ProjectID, &ws.Kind, &ws.Name, &ws.CreatedAt, &ws.UpdatedAt)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &ws, nil
}

// GetByID fetches a single workspace by its id (tenant-scoped via RLS).
func (s *Workspaces) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Workspace, error) {
	var ws domain.Workspace
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT id, tenant_id, project_id, kind, name, created_at, updated_at
			FROM workspace
			WHERE tenant_id=$1 AND id=$2`,
			tid, id,
		).Scan(&ws.ID, &ws.TenantID, &ws.ProjectID, &ws.Kind, &ws.Name, &ws.CreatedAt, &ws.UpdatedAt)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &ws, nil
}

// ListAll returns all workspaces for a tenant, optionally filtered by kind.
// Used by the cross-project Document Hub (workspaces list / hub dashboard)
// where no single project_id is in scope.
func (s *Workspaces) ListAll(ctx context.Context, tid uuid.UUID, kind domain.WorkspaceKind, limit, offset int) ([]*domain.Workspace, int, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if kind != "" {
		where = append(where, fmt.Sprintf("kind = $%d", idx))
		args = append(args, string(kind))
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.Workspace
	var total int
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, fmt.Sprintf(`
			SELECT id, tenant_id, project_id, kind, name, created_at, updated_at
			FROM workspace
			WHERE %s
			ORDER BY created_at DESC
			LIMIT $%d OFFSET $%d`, whereSQL, idx, idx+1),
			append(args, limit, offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var ws domain.Workspace
			if err := rows.Scan(&ws.ID, &ws.TenantID, &ws.ProjectID, &ws.Kind, &ws.Name, &ws.CreatedAt, &ws.UpdatedAt); err != nil {
				return err
			}
			items = append(items, &ws)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, fmt.Sprintf("SELECT count(*) FROM workspace WHERE %s", whereSQL), args...).Scan(&total)
	})
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// ListForProject returns all workspaces for a project.
func (s *Workspaces) ListForProject(ctx context.Context, tid, projectID uuid.UUID) ([]*domain.Workspace, error) {
	var items []*domain.Workspace
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, project_id, kind, name, created_at, updated_at
			FROM workspace
			WHERE tenant_id=$1 AND project_id=$2
			ORDER BY kind`,
			tid, projectID,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var ws domain.Workspace
			if err := rows.Scan(&ws.ID, &ws.TenantID, &ws.ProjectID, &ws.Kind, &ws.Name, &ws.CreatedAt, &ws.UpdatedAt); err != nil {
				return err
			}
			items = append(items, &ws)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return items, nil
}
