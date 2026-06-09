// Package api — cedar_loader.go implements the libauth.ResourceLoader for
// document-svc. Plan #6 Task 6 Step 2.
//
// Supported entity types: Document (owner_id → owner_user), Workspace,
// Comment, Template. RLS GUC is bound to the caller's JWT tenant for every
// lookup so cross-tenant uids degrade gracefully to `{}`.
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

// CedarLoader resolves resource attributes for document-svc.
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
	case "Document":
		var tid uuid.UUID
		var owner *uuid.UUID
		if err := l.withTenant(ctx, callerTenant, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`SELECT tenant_id, owner_id FROM document WHERE id = $1 AND deleted_at IS NULL`,
				id).Scan(&tid, &owner)
		}); err != nil {
			return map[string]any{}, nil
		}
		attrs := map[string]any{"tenant_id": tid.String()}
		if owner != nil {
			attrs["owner_user"] = owner.String()
		}
		return attrs, nil
	case "Workspace":
		var tid uuid.UUID
		if err := l.withTenant(ctx, callerTenant, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`SELECT tenant_id FROM workspace WHERE id = $1`, id).Scan(&tid)
		}); err != nil {
			return map[string]any{}, nil
		}
		return map[string]any{"tenant_id": tid.String()}, nil
	case "Comment":
		var tid uuid.UUID
		var author *uuid.UUID
		if err := l.withTenant(ctx, callerTenant, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`SELECT tenant_id, author_id FROM document_comment WHERE id = $1`, id).Scan(&tid, &author)
		}); err != nil {
			return map[string]any{}, nil
		}
		attrs := map[string]any{"tenant_id": tid.String()}
		if author != nil {
			attrs["owner_user"] = author.String()
		}
		return attrs, nil
	case "Template":
		var tid uuid.UUID
		if err := l.withTenant(ctx, callerTenant, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`SELECT tenant_id FROM document_template WHERE id = $1`, id).Scan(&tid)
		}); err != nil {
			return map[string]any{}, nil
		}
		return map[string]any{"tenant_id": tid.String()}, nil
	case "SignEnvelope":
		var tid uuid.UUID
		var creator *uuid.UUID
		if err := l.withTenant(ctx, callerTenant, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`SELECT tenant_id, created_by FROM document_sign_envelope WHERE id = $1`, id).Scan(&tid, &creator)
		}); err != nil {
			return map[string]any{}, nil
		}
		attrs := map[string]any{"tenant_id": tid.String()}
		if creator != nil {
			attrs["owner_user"] = creator.String()
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
