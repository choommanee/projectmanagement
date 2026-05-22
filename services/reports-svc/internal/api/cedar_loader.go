// Package api — cedar_loader.go implements the libauth.ResourceLoader for
// reports-svc. Plan #6 Task 6 Step 2.
//
// Supported entity types: Dashboard. dashboard rows carry an `owner_id` so
// the loader exposes `owner_user` alongside `tenant_id` to enable
// owner-only update / delete predicates in the Cedar bundle.
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

// CedarLoader resolves resource attributes for reports-svc.
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
	case "Dashboard":
		var tid uuid.UUID
		var owner *uuid.UUID
		if err := l.withTenant(ctx, callerTenant, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`SELECT tenant_id, owner_id FROM dashboard WHERE id = $1`, id).Scan(&tid, &owner)
		}); err != nil {
			return map[string]any{}, nil
		}
		attrs := map[string]any{"tenant_id": tid.String()}
		if owner != nil {
			attrs["owner_user"] = owner.String()
		}
		return attrs, nil
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
