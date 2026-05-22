// Package api — cedar_loader.go implements the libauth.ResourceLoader for
// project-svc. Plan #6 Task 6 Step 2.
//
// Supported entity types: Project, Task, Sprint. Each lookup returns
// `tenant_id` (and `owner_user` for Project, which carries an owner_id
// column). All queries run inside a transaction with `SET LOCAL
// app.current_tenant` bound to the caller's JWT tenant; cross-tenant
// requests therefore see nothing and the loader returns `{}` — the policy
// `has tenant_id` guards make that a no-op and the underlying handler will
// 404 via the same RLS protection.
package api

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	libauth "github.com/pmplatform/libs/go/auth"
)

// CedarLoader resolves resource attributes for project-svc.
type CedarLoader struct{ p *pgxpool.Pool }

// NewCedarLoader wires the loader against the service pool.
func NewCedarLoader(p *pgxpool.Pool) *CedarLoader { return &CedarLoader{p: p} }

// LoadAttrs implements libauth.ResourceLoader.
func (l *CedarLoader) LoadAttrs(ctx context.Context, uid string) (map[string]any, error) {
	typ, idStr, ok := splitUID(uid)
	if !ok {
		return map[string]any{}, nil
	}
	c, ok := libauth.FromCtx(ctx)
	if !ok || c == nil || c.TenantID == "" {
		return map[string]any{}, nil
	}
	callerTenant, err := uuid.Parse(c.TenantID)
	if err != nil {
		return map[string]any{}, nil
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		return map[string]any{}, nil
	}

	switch typ {
	case "Project":
		var tid, ownerID uuid.UUID
		var owner *uuid.UUID
		if err := l.withTenant(ctx, callerTenant, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`SELECT tenant_id, owner_id FROM project WHERE id = $1 AND deleted_at IS NULL`,
				id).Scan(&tid, &owner)
		}); err != nil {
			return map[string]any{}, nil
		}
		attrs := map[string]any{"tenant_id": tid.String()}
		if owner != nil {
			ownerID = *owner
			attrs["owner_user"] = ownerID.String()
		}
		return attrs, nil
	case "Task":
		var tid uuid.UUID
		if err := l.withTenant(ctx, callerTenant, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`SELECT tenant_id FROM task WHERE id = $1 AND deleted_at IS NULL`, id).Scan(&tid)
		}); err != nil {
			return map[string]any{}, nil
		}
		return map[string]any{"tenant_id": tid.String()}, nil
	case "Sprint":
		var tid uuid.UUID
		if err := l.withTenant(ctx, callerTenant, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`SELECT tenant_id FROM sprint WHERE id = $1`, id).Scan(&tid)
		}); err != nil {
			return map[string]any{}, nil
		}
		return map[string]any{"tenant_id": tid.String()}, nil
	default:
		return map[string]any{}, nil
	}
}

func (l *CedarLoader) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
	tx, err := l.p.Begin(ctx)
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

func splitUID(uid string) (string, string, bool) {
	idx := strings.Index(uid, `::"`)
	if idx < 0 || !strings.HasSuffix(uid, `"`) {
		return "", "", false
	}
	return uid[:idx], uid[idx+3 : len(uid)-1], true
}
