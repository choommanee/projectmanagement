// Package api — cedar_loader.go implements the libauth.ResourceLoader for
// tenant-svc. Plan #6 Task 6 Step 2.
//
// The loader resolves a Cedar resource UID like `Tenant::"<uuid>"` against
// the tenant table so the ABAC layer can express `resource.tenant_id ==
// context.tenant_id`. For tenant-svc the resource IS the tenant, so we just
// echo the tenant id as the `tenant_id` attribute.
//
// All queries run inside a transaction with `SET LOCAL app.current_tenant`
// bound to the caller's JWT tenant — required so the loader can never become
// a cross-tenant leak vector. Unknown UID types return an empty map (the
// shared Cedar policy treats absent attrs as a no-op).
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

// CedarLoader resolves resource attributes for tenant-svc.
type CedarLoader struct{ p *pgxpool.Pool }

// NewCedarLoader wires the loader against the service pool.
func NewCedarLoader(p *pgxpool.Pool) *CedarLoader { return &CedarLoader{p: p} }

// LoadAttrs implements libauth.ResourceLoader. uid is of the form
// `Type::"id"`. Returns `{}` for unsupported types so the policy falls back
// to the role-based permit.
func (l *CedarLoader) LoadAttrs(ctx context.Context, uid string) (map[string]any, error) {
	typ, id, ok := splitUID(uid)
	if !ok {
		return map[string]any{}, nil
	}
	// Pull the caller's tenant from the JWT for the RLS GUC. Without it the
	// loader has no scope; refuse rather than running unscoped.
	c, ok := libauth.FromCtx(ctx)
	if !ok || c == nil || c.TenantID == "" {
		return map[string]any{}, nil
	}
	callerTenant, err := uuid.Parse(c.TenantID)
	if err != nil {
		return map[string]any{}, nil
	}

	switch typ {
	case "Tenant":
		// For tenant-svc the resource is the tenant itself; tenant_id ==
		// the row's primary key. We honour RLS even though tenant rows are
		// platform-scoped so the loader stays consistent with other svcs.
		tid, err := uuid.Parse(id)
		if err != nil {
			return map[string]any{}, nil
		}
		var got uuid.UUID
		if err := l.withTenant(ctx, callerTenant, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, `SELECT id FROM tenant WHERE id = $1`, tid).Scan(&got)
		}); err != nil {
			return map[string]any{}, nil
		}
		return map[string]any{"tenant_id": got.String()}, nil
	default:
		return map[string]any{}, nil
	}
}

// withTenant wraps a callback in a tx that sets the RLS GUC to the caller's
// tenant. Loaders MUST run under RLS so they can't leak cross-tenant data
// even when the caller-supplied UID points to a foreign row.
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

// splitUID parses Cedar `Type::"id"` strings into (type, id, ok).
func splitUID(uid string) (string, string, bool) {
	idx := strings.Index(uid, `::"`)
	if idx < 0 || !strings.HasSuffix(uid, `"`) {
		return "", "", false
	}
	return uid[:idx], uid[idx+3 : len(uid)-1], true
}
