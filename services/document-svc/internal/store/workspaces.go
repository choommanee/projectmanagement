package store

import (
	"context"
	"errors"
	"fmt"

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
