package service_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/workflow-svc/internal/domain"
	"github.com/pmplatform/services/workflow-svc/internal/service"
	"github.com/pmplatform/services/workflow-svc/internal/store"
)

func openPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	return p
}

func seedTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		"INSERT INTO tenant(id, slug, name, tier, status, region) VALUES ($1,$2,$3,'shared','active','us')",
		tid, "svc-test-"+tid.String()[:8], "SVC Test "+tid.String()[:8])
	if err != nil {
		t.Fatalf("seedTenant: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tid) //nolint:errcheck
	})
	return tid
}

func setupDefAndVersion(t *testing.T, pool *pgxpool.Pool, tid uuid.UUID) (*domain.WorkflowDefinition, *domain.WorkflowVersion) {
	t.Helper()
	defs := store.NewDefinitions(pool)
	vers := store.NewVersions(pool)

	d := &domain.WorkflowDefinition{
		ID:             uuid.New(),
		TenantID:       tid,
		Name:           "Service Test Workflow",
		Status:         domain.WorkflowPublished,
		CurrentVersion: 1,
		Version:        1,
	}
	if err := defs.Create(context.Background(), d); err != nil {
		t.Fatalf("create def: %v", err)
	}

	dsl, _ := json.Marshal(map[string]any{
		"id": "v1",
		"steps": []any{
			map[string]any{"id": "calc", "type": "expression", "expr": "input.amount + 100", "out": "sum"},
			map[string]any{"id": "end", "type": "end", "result": "done"},
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

	return d, v
}

func TestServiceStartInstance_WithRuntime(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)
	d, _ := setupDefAndVersion(t, pool, tid)

	// Start a mock runtime server
	mockRuntime := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]any{
			"status":      "completed",
			"variables":   map[string]any{"sum": 150},
			"output":      "done",
			"cursor":      nil,
			"error":       nil,
			"steps":       []any{
				map[string]any{
					"step_id": "calc", "step_type": "expression",
					"status": "completed",
					"input":  map[string]any{},
					"output": map[string]any{"sum": 150},
					"error":  nil, "duration_ms": 1,
				},
				map[string]any{
					"step_id": "end", "step_type": "end",
					"status": "completed",
					"input":  map[string]any{},
					"output": "done",
					"error":  nil, "duration_ms": 0,
				},
			},
			"human_tasks": []any{},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer mockRuntime.Close()

	svc := service.New(
		store.NewDefinitions(pool),
		store.NewVersions(pool),
		store.NewInstances(pool),
		store.NewHumanTasks(pool),
		mockRuntime.URL,
	)

	result, err := svc.StartInstance(context.Background(), service.StartInstanceInput{
		TenantID:     tid,
		DefinitionID: d.ID,
		Input:        json.RawMessage(`{"amount":50}`),
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if result.Instance.Status != domain.InstanceCompleted {
		t.Errorf("expected completed, got %s", result.Instance.Status)
	}
}

func TestServiceStartInstance_RuntimeDown(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)
	d, _ := setupDefAndVersion(t, pool, tid)

	svc := service.New(
		store.NewDefinitions(pool),
		store.NewVersions(pool),
		store.NewInstances(pool),
		store.NewHumanTasks(pool),
		"http://localhost:19999", // not running
	)

	_, err := svc.StartInstance(context.Background(), service.StartInstanceInput{
		TenantID:     tid,
		DefinitionID: d.ID,
		Input:        json.RawMessage(`{}`),
	})
	if err == nil {
		t.Error("expected error when runtime is down, got nil")
	}
}
