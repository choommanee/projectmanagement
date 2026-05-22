// Package api — cedar_loader.go implements the libauth.ResourceLoader for
// quality-svc. Plan #6 Task 6 Step 2.
//
// Supported entity types: APQP, PPAP, PPAPElement, FMEA, FMEAMode,
// ControlPlan, ControlChar, Inspection, NCR, CAPA. Quality entities are
// process artefacts without a notional `owner_user`; only `tenant_id` is
// surfaced.
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

// CedarLoader resolves resource attributes for quality-svc.
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

	table, ok := qualityTableForType(typ)
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

func qualityTableForType(typ string) (string, bool) {
	switch typ {
	case "APQP":
		return "apqp_project", true
	case "PPAP":
		return "ppap_submission", true
	case "PPAPElement":
		return "ppap_element", true
	case "FMEA":
		return "fmea", true
	case "FMEAMode":
		return "fmea_failure_mode", true
	case "ControlPlan":
		return "control_plan", true
	case "ControlChar":
		return "control_plan_characteristic", true
	case "Inspection":
		return "inspection", true
	case "NCR":
		return "nonconformance", true
	case "CAPA":
		return "capa", true
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
