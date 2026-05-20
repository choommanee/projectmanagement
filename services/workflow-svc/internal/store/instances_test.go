package store_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/workflow-svc/internal/domain"
	"github.com/pmplatform/services/workflow-svc/internal/store"
)

// seedDefAndVersion creates a definition + version and returns both.
func seedDefAndVersion(t *testing.T, p interface {
	Exec(ctx context.Context, sql string, args ...any) (any, error)
}, defs *store.Definitions, vers *store.Versions, tid uuid.UUID) (*domain.WorkflowDefinition, *domain.WorkflowVersion) {
	t.Helper()
	// Create a pool-aware wrapper directly
	return nil, nil // unused, see below
}

func TestInstanceCreate(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	defs := store.NewDefinitions(p)
	vers := store.NewVersions(p)
	insts := store.NewInstances(p)

	// Setup
	d := &domain.WorkflowDefinition{
		ID: uuid.New(), TenantID: tid, Name: "Inst Test",
		Status: domain.WorkflowDraft, CurrentVersion: 1, Version: 1,
	}
	if err := defs.Create(context.Background(), d); err != nil {
		t.Fatalf("create def: %v", err)
	}
	dsl, _ := json.Marshal(map[string]any{"id": "v1", "steps": []any{}})
	v := &domain.WorkflowVersion{
		ID: uuid.New(), TenantID: tid, DefinitionID: d.ID, Rev: 1, DSL: dsl,
	}
	if err := vers.Create(context.Background(), v); err != nil {
		t.Fatalf("create ver: %v", err)
	}

	inst := &domain.WorkflowInstance{
		ID:           uuid.New(),
		TenantID:     tid,
		DefinitionID: d.ID,
		VersionID:    v.ID,
		Status:       domain.InstanceRunning,
		Input:        json.RawMessage(`{"amount":50}`),
		Variables:    json.RawMessage(`{}`),
		TriggerKind:  domain.TriggerManual,
	}
	if err := insts.Create(context.Background(), inst); err != nil {
		t.Fatalf("create inst: %v", err)
	}

	got, err := insts.GetByID(context.Background(), tid, inst.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Status != domain.InstanceRunning {
		t.Errorf("expected running, got %s", got.Status)
	}
}

func TestInstanceListByStatus(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	defs := store.NewDefinitions(p)
	vers := store.NewVersions(p)
	insts := store.NewInstances(p)

	d := &domain.WorkflowDefinition{
		ID: uuid.New(), TenantID: tid, Name: "List By Status",
		Status: domain.WorkflowDraft, CurrentVersion: 1, Version: 1,
	}
	defs.Create(context.Background(), d) //nolint:errcheck
	dsl, _ := json.Marshal(map[string]any{"id": "v1", "steps": []any{}})
	v := &domain.WorkflowVersion{
		ID: uuid.New(), TenantID: tid, DefinitionID: d.ID, Rev: 1, DSL: dsl,
	}
	vers.Create(context.Background(), v) //nolint:errcheck

	// Create one running and one paused
	for _, st := range []domain.InstanceStatus{domain.InstanceRunning, domain.InstancePaused} {
		inst := &domain.WorkflowInstance{
			ID:           uuid.New(),
			TenantID:     tid,
			DefinitionID: d.ID,
			VersionID:    v.ID,
			Status:       st,
			Input:        json.RawMessage(`{}`),
			Variables:    json.RawMessage(`{}`),
			TriggerKind:  domain.TriggerManual,
		}
		insts.Create(context.Background(), inst) //nolint:errcheck
	}

	items, total, err := insts.ListByDefinition(context.Background(), tid, d.ID, store.ListInstancesOpts{
		Status: "paused", Limit: 50,
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if total < 1 {
		t.Error("expected at least 1 paused instance")
	}
	for _, inst := range items {
		if inst.Status != domain.InstancePaused {
			t.Errorf("unexpected status: %s", inst.Status)
		}
	}
}

func TestInstanceBulkUpdateSteps(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	defs := store.NewDefinitions(p)
	vers := store.NewVersions(p)
	insts := store.NewInstances(p)

	d := &domain.WorkflowDefinition{
		ID: uuid.New(), TenantID: tid, Name: "Bulk Update Steps",
		Status: domain.WorkflowDraft, CurrentVersion: 1, Version: 1,
	}
	defs.Create(context.Background(), d) //nolint:errcheck
	dsl, _ := json.Marshal(map[string]any{"id": "v1", "steps": []any{}})
	v := &domain.WorkflowVersion{
		ID: uuid.New(), TenantID: tid, DefinitionID: d.ID, Rev: 1, DSL: dsl,
	}
	vers.Create(context.Background(), v) //nolint:errcheck

	inst := &domain.WorkflowInstance{
		ID:           uuid.New(),
		TenantID:     tid,
		DefinitionID: d.ID,
		VersionID:    v.ID,
		Status:       domain.InstanceRunning,
		Input:        json.RawMessage(`{}`),
		Variables:    json.RawMessage(`{}`),
		TriggerKind:  domain.TriggerManual,
	}
	insts.Create(context.Background(), inst) //nolint:errcheck

	// Update state with steps
	inst.Status = domain.InstanceCompleted
	inst.Variables = json.RawMessage(`{"sum":150}`)
	inst.Output = json.RawMessage(`"done"`)
	steps := []domain.StepExecution{
		{
			ID:       uuid.New(),
			TenantID: tid,
			StepID:   "calc1",
			StepType: "expression",
			Status:   domain.StepCompleted,
			Input:    json.RawMessage(`{}`),
			Output:   json.RawMessage(`{"sum":150}`),
		},
	}
	if err := insts.UpdateStateAndSteps(context.Background(), tid, inst, steps, nil); err != nil {
		t.Fatalf("update: %v", err)
	}

	// Verify steps persisted
	persisted, err := insts.ListSteps(context.Background(), tid, inst.ID)
	if err != nil {
		t.Fatalf("list steps: %v", err)
	}
	if len(persisted) != 1 {
		t.Errorf("expected 1 step, got %d", len(persisted))
	}
	if persisted[0].StepID != "calc1" {
		t.Errorf("wrong step_id: %s", persisted[0].StepID)
	}
}
