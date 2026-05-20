package store_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/workflow-svc/internal/domain"
	"github.com/pmplatform/services/workflow-svc/internal/store"
)

func TestVersionPublish(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	defs := store.NewDefinitions(p)
	vers := store.NewVersions(p)

	// Create definition
	d := &domain.WorkflowDefinition{
		ID:             uuid.New(),
		TenantID:       tid,
		Name:           "Publish Test",
		Status:         domain.WorkflowDraft,
		CurrentVersion: 1,
		Version:        1,
	}
	if err := defs.Create(context.Background(), d); err != nil {
		t.Fatalf("create def: %v", err)
	}

	// Create version
	dsl, _ := json.Marshal(map[string]any{
		"id": "v1",
		"steps": []map[string]any{
			{"id": "end", "type": "end"},
		},
	})
	v := &domain.WorkflowVersion{
		ID:           uuid.New(),
		TenantID:     tid,
		DefinitionID: d.ID,
		Rev:          1,
		DSL:          dsl,
	}
	if err := vers.Create(context.Background(), v); err != nil {
		t.Fatalf("create ver: %v", err)
	}

	// Publish
	if err := defs.PublishVersion(context.Background(), tid, d.ID, 1, d.Version); err != nil {
		t.Fatalf("publish: %v", err)
	}

	// Verify published
	d2, err := defs.GetByID(context.Background(), tid, d.ID)
	if err != nil {
		t.Fatalf("get def: %v", err)
	}
	if d2.Status != domain.WorkflowPublished {
		t.Errorf("expected published, got %s", d2.Status)
	}
	if d2.CurrentVersion != 1 {
		t.Errorf("expected current_version=1, got %d", d2.CurrentVersion)
	}

	// GetCurrent should return the version
	cur, err := vers.GetCurrent(context.Background(), tid, d.ID)
	if err != nil {
		t.Fatalf("get current: %v", err)
	}
	if cur.Rev != 1 {
		t.Errorf("expected rev=1, got %d", cur.Rev)
	}
}
