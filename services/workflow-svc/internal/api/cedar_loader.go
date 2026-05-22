// Package api — cedar_loader.go implements the libauth.ResourceLoader for
// workflow-svc. Plan #6 Task 6 Step 2.
//
// Supported entity types: Workflow, WorkflowVersion, Instance, HumanTask,
// StepExecution. All return `{tenant_id: "..."}` resolved via the relevant
// table under the caller's RLS tenant.
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

// CedarLoader resolves resource attributes for workflow-svc.
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

	table, ok := workflowTableForType(typ)
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

func workflowTableForType(typ string) (string, bool) {
	switch typ {
	case "Workflow":
		return "workflow_definition", true
	case "WorkflowVersion":
		return "workflow_version", true
	case "Instance":
		return "workflow_instance", true
	case "HumanTask":
		return "human_task", true
	case "StepExecution":
		return "step_execution", true
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
