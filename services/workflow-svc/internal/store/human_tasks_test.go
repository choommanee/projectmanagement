package store_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/workflow-svc/internal/domain"
	"github.com/pmplatform/services/workflow-svc/internal/store"
)

func TestHumanTaskCreateAndComplete(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	defs := store.NewDefinitions(p)
	vers := store.NewVersions(p)
	insts := store.NewInstances(p)
	ht := store.NewHumanTasks(p)

	// Setup definition + version + instance
	d := &domain.WorkflowDefinition{
		ID: uuid.New(), TenantID: tid, Name: "HT Test",
		Status: domain.WorkflowDraft, CurrentVersion: 1, Version: 1,
	}
	defs.Create(context.Background(), d) //nolint:errcheck

	dsl, _ := json.Marshal(map[string]any{"id": "v1", "steps": []any{
		map[string]any{"id": "approve", "type": "human_task"},
	}})
	v := &domain.WorkflowVersion{
		ID: uuid.New(), TenantID: tid, DefinitionID: d.ID, Rev: 1, DSL: dsl,
	}
	vers.Create(context.Background(), v) //nolint:errcheck

	inst := &domain.WorkflowInstance{
		ID:           uuid.New(),
		TenantID:     tid,
		DefinitionID: d.ID,
		VersionID:    v.ID,
		Status:       domain.InstancePaused,
		Input:        json.RawMessage(`{}`),
		Variables:    json.RawMessage(`{}`),
		TriggerKind:  domain.TriggerManual,
	}
	insts.Create(context.Background(), inst) //nolint:errcheck

	// Insert human task via UpdateStateAndSteps
	humanTasks := []domain.HumanTask{
		{
			ID:         uuid.New(),
			TenantID:   tid,
			InstanceID: inst.ID,
			StepID:     "approve",
			Form:       json.RawMessage(`{"prompt":"Approve?"}`),
		},
	}
	inst.Output = json.RawMessage(`null`)
	insts.UpdateStateAndSteps(context.Background(), tid, inst, nil, humanTasks) //nolint:errcheck

	// List
	tasks, total, err := ht.List(context.Background(), tid, store.ListHumanTasksOpts{
		InstanceID: &inst.ID, Limit: 50,
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if total != 1 {
		t.Fatalf("expected 1 task, got %d", total)
	}
	taskID := tasks[0].ID

	// Complete
	completed, err := ht.Complete(context.Background(), tid, taskID, "approved", json.RawMessage(`{"note":"looks good"}`))
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if completed.Outcome == nil || *completed.Outcome != "approved" {
		t.Errorf("expected outcome=approved, got %v", completed.Outcome)
	}
	if completed.CompletedAt == nil {
		t.Error("expected completed_at to be set")
	}
}

func TestHumanTaskListByAssignee(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	defs := store.NewDefinitions(p)
	vers := store.NewVersions(p)
	insts := store.NewInstances(p)
	htStore := store.NewHumanTasks(p)

	// Setup
	d := &domain.WorkflowDefinition{
		ID: uuid.New(), TenantID: tid, Name: "HT Assignee Test",
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
		Status:       domain.InstancePaused,
		Input:        json.RawMessage(`{}`),
		Variables:    json.RawMessage(`{}`),
		TriggerKind:  domain.TriggerManual,
	}
	insts.Create(context.Background(), inst) //nolint:errcheck

	assigneeID := uuid.New()
	humanTasks := []domain.HumanTask{
		{
			ID:         uuid.New(),
			TenantID:   tid,
			InstanceID: inst.ID,
			StepID:     "step1",
			AssigneeID: &assigneeID,
			Form:       json.RawMessage(`{}`),
		},
	}
	inst.Output = json.RawMessage(`null`)
	insts.UpdateStateAndSteps(context.Background(), tid, inst, nil, humanTasks) //nolint:errcheck

	tasks, total, err := htStore.List(context.Background(), tid, store.ListHumanTasksOpts{
		AssigneeID: &assigneeID,
		Status:     "open",
		Limit:      50,
	})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if total < 1 {
		t.Errorf("expected >=1 task for assignee, got %d", total)
	}
	_ = tasks
}
