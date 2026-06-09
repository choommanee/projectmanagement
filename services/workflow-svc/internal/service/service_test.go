package service_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	notiflib "github.com/pmplatform/libs/go/notification"

	"github.com/pmplatform/services/workflow-svc/internal/domain"
	"github.com/pmplatform/services/workflow-svc/internal/scheduler"
	"github.com/pmplatform/services/workflow-svc/internal/service"
	"github.com/pmplatform/services/workflow-svc/internal/store"
)

type fakePublisher struct {
	events []notiflib.Event
}

func (f *fakePublisher) Publish(_ context.Context, ev notiflib.Event) error {
	f.events = append(f.events, ev)
	return nil
}

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
			"status":    "completed",
			"variables": map[string]any{"sum": 150},
			"output":    "done",
			"cursor":    nil,
			"error":     nil,
			"steps": []any{
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

// TestStartInstance_PublishesCompletedNotif asserts that when the runtime
// returns status=completed, a "workflow.instance.completed" event is
// published to the injected notif publisher.
func TestStartInstance_PublishesCompletedNotif(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)
	d, _ := setupDefAndVersion(t, pool, tid)

	mockRuntime := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]any{
			"status":      "completed",
			"variables":   map[string]any{},
			"output":      "done",
			"cursor":      nil,
			"error":       nil,
			"steps":       []any{},
			"human_tasks": []any{},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp) //nolint:errcheck
	}))
	defer mockRuntime.Close()

	pub := &fakePublisher{}
	svc := service.New(
		store.NewDefinitions(pool),
		store.NewVersions(pool),
		store.NewInstances(pool),
		store.NewHumanTasks(pool),
		mockRuntime.URL,
	).WithNotifPublisher(pub)

	result, err := svc.StartInstance(context.Background(), service.StartInstanceInput{
		TenantID:     tid,
		DefinitionID: d.ID,
		Input:        json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if result.Instance.Status != domain.InstanceCompleted {
		t.Fatalf("expected completed, got %s", result.Instance.Status)
	}

	if len(pub.events) != 1 {
		t.Fatalf("expected 1 notif event, got %d", len(pub.events))
	}
	ev := pub.events[0]
	if ev.Kind != "workflow.instance.completed" {
		t.Errorf("Kind: got %q, want %q", ev.Kind, "workflow.instance.completed")
	}
	if ev.TenantID != tid.String() {
		t.Errorf("TenantID: got %q, want %q", ev.TenantID, tid.String())
	}
}

// stagedRuntime serves a sequence of canned ExecuteOutput responses — one per
// /execute call — so we can simulate start (paused) → resume (completed)
// without running the real Rust engine.
func stagedRuntime(t *testing.T, stages []map[string]any) *httptest.Server {
	t.Helper()
	call := 0
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		idx := call
		if idx >= len(stages) {
			idx = len(stages) - 1
		}
		call++
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(stages[idx])
	}))
}

func newSvc(pool *pgxpool.Pool, runtimeURL string, pub notiflib.Publisher) *service.Service {
	s := service.New(
		store.NewDefinitions(pool),
		store.NewVersions(pool),
		store.NewInstances(pool),
		store.NewHumanTasks(pool),
		runtimeURL,
	)
	if pub != nil {
		s = s.WithNotifPublisher(pub)
	}
	return s
}

// TestHumanTaskFullCycle exercises the canonical inbox flow:
// start (expression→switch→human_task) → paused + task created → assignee
// notified → complete task → resume → completed, with set_variable applied.
func TestHumanTaskFullCycle(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)
	d, _ := setupDefAndVersion(t, pool, tid)

	assignee := uuid.New()

	// Stage 0: start → paused with a human task at step "approve".
	staged := []map[string]any{
		{
			"status":    "paused",
			"variables": map[string]any{"checked": true},
			"output":    nil,
			"cursor":    "approve",
			"error":     nil,
			"steps": []any{
				map[string]any{"step_id": "check", "step_type": "expression", "status": "completed",
					"input": map[string]any{}, "output": map[string]any{"checked": true}, "error": nil, "duration_ms": 1},
				map[string]any{"step_id": "approve", "step_type": "human_task", "status": "running",
					"input": map[string]any{}, "output": map[string]any{"queued": true}, "error": nil, "duration_ms": 0},
			},
			"human_tasks": []any{
				map[string]any{"step_id": "approve", "assignee": assignee.String(),
					"form": map[string]any{"prompt": "Approve?", "fields": []any{}}},
			},
			"notifications": []any{},
			"wake_seconds":  nil,
		},
		// Stage 1: resume → completed.
		{
			"status":    "completed",
			"variables": map[string]any{"checked": true, "approved": true},
			"output":    "done",
			"cursor":    nil,
			"error":     nil,
			"steps": []any{
				map[string]any{"step_id": "record", "step_type": "set_variable", "status": "completed",
					"input": map[string]any{}, "output": map[string]any{"approved": true}, "error": nil, "duration_ms": 0},
				map[string]any{"step_id": "end", "step_type": "end", "status": "completed",
					"input": map[string]any{}, "output": "done", "error": nil, "duration_ms": 0},
			},
			"human_tasks":   []any{},
			"notifications": []any{},
			"wake_seconds":  nil,
		},
	}
	rt := stagedRuntime(t, staged)
	defer rt.Close()

	pub := &fakePublisher{}
	svc := newSvc(pool, rt.URL, pub)

	// Start → should be paused with one open human task.
	res, err := svc.StartInstance(context.Background(), service.StartInstanceInput{
		TenantID: tid, DefinitionID: d.ID, Input: json.RawMessage(`{"amount":2000}`),
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if res.Instance.Status != domain.InstancePaused {
		t.Fatalf("expected paused, got %s", res.Instance.Status)
	}
	if len(res.HumanTasks) != 1 {
		t.Fatalf("expected 1 human task, got %d", len(res.HumanTasks))
	}
	htID := res.HumanTasks[0].ID
	if res.HumanTasks[0].AssigneeID == nil || *res.HumanTasks[0].AssigneeID != assignee {
		t.Fatalf("assignee not persisted")
	}

	// Assignee should have been notified.
	var assignedNotif bool
	for _, ev := range pub.events {
		if ev.Kind == "workflow.human_task.assigned" && ev.UserID == assignee.String() {
			assignedNotif = true
		}
	}
	if !assignedNotif {
		t.Errorf("expected workflow.human_task.assigned notif for assignee")
	}

	// Complete the human task → resume → completed.
	res2, err := svc.CompleteHumanTask(context.Background(), tid, htID, "approved", json.RawMessage(`{"comment":"ok"}`))
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if res2.Instance.Status != domain.InstanceCompleted {
		t.Fatalf("expected completed after resume, got %s", res2.Instance.Status)
	}

	// Idempotency: completing again must not re-resume; returns ErrNotFound.
	_, err = svc.CompleteHumanTask(context.Background(), tid, htID, "approved", nil)
	if err == nil {
		t.Errorf("expected error on double-complete, got nil")
	}
}

// TestWaitTimerWakesViaPoller verifies that a wait step sets wake_at and the
// scheduler poller resumes the instance once the timer elapses.
func TestWaitTimerWakesViaPoller(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)
	d, _ := setupDefAndVersion(t, pool, tid)

	staged := []map[string]any{
		{ // start → paused on wait, wake in 0s (immediately due)
			"status": "paused", "variables": map[string]any{}, "output": nil,
			"cursor": "pause", "error": nil,
			"steps": []any{map[string]any{"step_id": "pause", "step_type": "wait", "status": "running",
				"input": map[string]any{}, "output": map[string]any{}, "error": nil, "duration_ms": 0}},
			"human_tasks": []any{}, "notifications": []any{}, "wake_seconds": 0,
		},
		{ // resume → completed
			"status": "completed", "variables": map[string]any{}, "output": "done",
			"cursor": nil, "error": nil, "steps": []any{}, "human_tasks": []any{},
			"notifications": []any{}, "wake_seconds": nil,
		},
	}
	rt := stagedRuntime(t, staged)
	defer rt.Close()

	instances := store.NewInstances(pool)
	svc := newSvc(pool, rt.URL, nil)

	res, err := svc.StartInstance(context.Background(), service.StartInstanceInput{
		TenantID: tid, DefinitionID: d.ID, Input: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if res.Instance.Status != domain.InstancePaused {
		t.Fatalf("expected paused, got %s", res.Instance.Status)
	}
	if res.Instance.WakeAt == nil {
		t.Fatalf("expected wake_at to be set")
	}

	// Run the poller once — should find the due instance and resume to completion.
	poller := scheduler.New(svc, instances, time.Second)
	n := poller.RunOnce(context.Background())
	if n < 1 {
		t.Fatalf("expected poller to find >=1 due instance, got %d", n)
	}

	inst, err := instances.GetByID(context.Background(), tid, res.Instance.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if inst.Status != domain.InstanceCompleted {
		t.Fatalf("expected completed after poller wake, got %s", inst.Status)
	}
}

// TestNotificationFanout verifies engine-resolved notifications are published.
func TestNotificationFanout(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)
	d, _ := setupDefAndVersion(t, pool, tid)

	recipient := uuid.New()
	staged := []map[string]any{{
		"status": "completed", "variables": map[string]any{}, "output": "done",
		"cursor": nil, "error": nil, "steps": []any{}, "human_tasks": []any{},
		"notifications": []any{
			map[string]any{"step_id": "notify", "channel": "email",
				"recipient": recipient.String(), "message": "Order shipped",
				"kind": "workflow.order_shipped", "title": "Shipped"},
		},
		"wake_seconds": nil,
	}}
	rt := stagedRuntime(t, staged)
	defer rt.Close()

	pub := &fakePublisher{}
	svc := newSvc(pool, rt.URL, pub)

	if _, err := svc.StartInstance(context.Background(), service.StartInstanceInput{
		TenantID: tid, DefinitionID: d.ID, Input: json.RawMessage(`{}`),
	}); err != nil {
		t.Fatalf("start: %v", err)
	}

	var found bool
	for _, ev := range pub.events {
		if ev.Kind == "workflow.order_shipped" && ev.UserID == recipient.String() && ev.Body == "Order shipped" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected order_shipped notif to recipient, events=%+v", pub.events)
	}
}

// TestRetryFailedInstance verifies a failed instance can be retried to success.
func TestRetryFailedInstance(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)
	d, _ := setupDefAndVersion(t, pool, tid)

	staged := []map[string]any{
		{ // start → failed
			"status": "failed", "variables": map[string]any{}, "output": nil,
			"cursor": "callout", "error": "http request failed",
			"steps": []any{map[string]any{"step_id": "callout", "step_type": "http", "status": "failed",
				"input": map[string]any{}, "output": nil, "error": "boom", "duration_ms": 5}},
			"human_tasks": []any{}, "notifications": []any{}, "wake_seconds": nil,
		},
		{ // retry → completed
			"status": "completed", "variables": map[string]any{}, "output": "done",
			"cursor": nil, "error": nil, "steps": []any{}, "human_tasks": []any{},
			"notifications": []any{}, "wake_seconds": nil,
		},
	}
	rt := stagedRuntime(t, staged)
	defer rt.Close()

	svc := newSvc(pool, rt.URL, nil)

	res, err := svc.StartInstance(context.Background(), service.StartInstanceInput{
		TenantID: tid, DefinitionID: d.ID, Input: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if res.Instance.Status != domain.InstanceFailed {
		t.Fatalf("expected failed, got %s", res.Instance.Status)
	}

	res2, err := svc.RetryInstance(context.Background(), tid, res.Instance.ID)
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if res2.Instance.Status != domain.InstanceCompleted {
		t.Fatalf("expected completed after retry, got %s", res2.Instance.Status)
	}

	// Retrying a non-failed instance is rejected.
	_, err = svc.RetryInstance(context.Background(), tid, res.Instance.ID)
	if err == nil {
		t.Errorf("expected error retrying completed instance")
	}
}
