// Package api — cedar_loader.go implements the libauth.ResourceLoader for
// mfg-svc. Plan #6 Task 6 Step 2.
//
// Supported entity types: Item, UOM, BOM, BOMLine, Routing, RoutingOp,
// WorkCenter, WorkOrder, Lot, MRPRun, Supplier, PO. Each returns
// `{tenant_id: "..."}`. None of these entities track an `owner_user` field today.
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

// CedarLoader resolves resource attributes for mfg-svc.
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

	// Mapping from Cedar resource type → the SQL table that owns the row.
	// All target tables carry a `tenant_id` column.
	table, ok := mfgTableForType(typ)
	if !ok {
		return map[string]any{}, nil
	}
	var tid uuid.UUID
	if err := l.withTenant(ctx, callerTenant, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			fmt.Sprintf(`SELECT tenant_id FROM %s WHERE id = $1`, table), id).Scan(&tid)
	}); err != nil {
		return map[string]any{}, nil
	}
	return map[string]any{"tenant_id": tid.String()}, nil
}

// mfgTableForType maps a Cedar entity type to the table holding its rows.
// Returns ok=false for types we don't recognize (loader returns `{}`).
func mfgTableForType(typ string) (string, bool) {
	switch typ {
	case "Item":
		return "item", true
	case "UOM":
		return "uom", true
	case "BOM":
		return "bom_header", true
	case "BOMLine":
		return "bom_line", true
	case "Routing":
		return "routing_header", true
	case "RoutingOp":
		return "routing_operation", true
	case "WorkCenter":
		return "work_center", true
	case "WorkOrder":
		return "work_order", true
	case "Lot":
		return "lot", true
	case "MRPRun":
		return "mrp_run", true
	case "Supplier":
		return "supplier", true
	case "PO":
		return "purchase_order", true
	}
	return "", false
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
