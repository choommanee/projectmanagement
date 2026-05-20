package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/workflow-svc/internal/api"
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
		tid, "api-test-"+tid.String()[:8], "API Test "+tid.String()[:8])
	if err != nil {
		t.Fatalf("seedTenant: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tid) //nolint:errcheck
	})
	return tid
}

// mockRuntimeServer returns a test server that simulates workflow-runtime /execute.
func mockRuntimeServer(t *testing.T, respBody any) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(respBody) //nolint:errcheck
	}))
}

func newTestApp(t *testing.T, pool *pgxpool.Pool, runtimeURL string) http.Handler {
	t.Helper()
	svc := service.New(
		store.NewDefinitions(pool),
		store.NewVersions(pool),
		store.NewInstances(pool),
		store.NewHumanTasks(pool),
		runtimeURL,
	)
	return api.NewRouter(svc)
}

func TestHealthz(t *testing.T) {
	app := api.NewRouter(nil)
	r := httptest.NewRequest("GET", "/healthz", nil)
	w := httptest.NewRecorder()
	app.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestMissingTenantHeader(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	app := newTestApp(t, pool, "http://localhost:19999")

	r := httptest.NewRequest("GET", "/v1/workflows", nil)
	// No X-Tenant-Id header
	w := httptest.NewRecorder()
	app.ServeHTTP(w, r)
	if w.Code != 400 {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestCreateWorkflow(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)
	app := newTestApp(t, pool, "http://localhost:19999")

	body := map[string]any{"name": "My Workflow", "description": "test"}
	data, _ := json.Marshal(body)
	r := httptest.NewRequest("POST", "/v1/workflows", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Tenant-Id", tid.String())
	w := httptest.NewRecorder()
	app.ServeHTTP(w, r)

	if w.Code != 201 {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp) //nolint:errcheck
	if resp["id"] == nil {
		t.Error("expected id in response")
	}
}

func TestCreateVersion(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)
	app := newTestApp(t, pool, "http://localhost:19999")

	// Create definition first
	defBody := map[string]any{"name": "Version Test Workflow"}
	data, _ := json.Marshal(defBody)
	r := httptest.NewRequest("POST", "/v1/workflows", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Tenant-Id", tid.String())
	w := httptest.NewRecorder()
	app.ServeHTTP(w, r)
	if w.Code != 201 {
		t.Fatalf("create def failed: %d", w.Code)
	}
	var def map[string]any
	json.Unmarshal(w.Body.Bytes(), &def) //nolint:errcheck
	defID := def["id"].(string)

	// Create version
	dsl := map[string]any{
		"id": "v1",
		"steps": []any{
			map[string]any{"id": "end", "type": "end"},
		},
	}
	vBody := map[string]any{"dsl": dsl, "notes": "initial"}
	data, _ = json.Marshal(vBody)
	r = httptest.NewRequest("POST", "/v1/workflows/"+defID+"/versions", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Tenant-Id", tid.String())
	w = httptest.NewRecorder()
	app.ServeHTTP(w, r)

	if w.Code != 201 {
		t.Errorf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestStartInstanceSimpleDSL(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)

	// Mock runtime
	rt := mockRuntimeServer(t, map[string]any{
		"status":    "completed",
		"variables": map[string]any{"sum": 150.0, "doubled": 300.0},
		"output":    "done",
		"cursor":    nil,
		"error":     nil,
		"steps": []any{
			map[string]any{
				"step_id": "calc1", "step_type": "expression",
				"status": "completed", "input": map[string]any{},
				"output": map[string]any{"sum": 150.0}, "error": nil, "duration_ms": 1,
			},
			map[string]any{
				"step_id": "end", "step_type": "end",
				"status": "completed", "input": map[string]any{},
				"output": "done", "error": nil, "duration_ms": 0,
			},
		},
		"human_tasks": []any{},
	})
	defer rt.Close()

	app := newTestApp(t, pool, rt.URL)

	// Create def
	defBody := map[string]any{"name": "Start Instance Test"}
	data, _ := json.Marshal(defBody)
	r := httptest.NewRequest("POST", "/v1/workflows", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Tenant-Id", tid.String())
	w := httptest.NewRecorder()
	app.ServeHTTP(w, r)
	var def map[string]any
	json.Unmarshal(w.Body.Bytes(), &def) //nolint:errcheck
	defID := def["id"].(string)

	// Create version
	dsl := map[string]any{
		"id": "v1",
		"steps": []any{
			map[string]any{"id": "calc1", "type": "expression", "expr": "input.amount + 100", "out": "sum"},
			map[string]any{"id": "end", "type": "end", "result": "done"},
		},
	}
	vBody := map[string]any{"dsl": dsl}
	data, _ = json.Marshal(vBody)
	r = httptest.NewRequest("POST", "/v1/workflows/"+defID+"/versions", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Tenant-Id", tid.String())
	w = httptest.NewRecorder()
	app.ServeHTTP(w, r)
	if w.Code != 201 {
		t.Fatalf("create version failed: %d %s", w.Code, w.Body.String())
	}

	// Publish
	pubBody := map[string]any{"rev": 1, "version": 1}
	data, _ = json.Marshal(pubBody)
	r = httptest.NewRequest("POST", "/v1/workflows/"+defID+"/publish", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Tenant-Id", tid.String())
	w = httptest.NewRecorder()
	app.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("publish failed: %d %s", w.Code, w.Body.String())
	}

	// Start
	startBody := map[string]any{"input": map[string]any{"amount": 50}}
	data, _ = json.Marshal(startBody)
	r = httptest.NewRequest("POST", "/v1/workflows/"+defID+"/start", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Tenant-Id", tid.String())
	w = httptest.NewRecorder()
	app.ServeHTTP(w, r)

	if w.Code != 201 {
		t.Fatalf("start failed: %d %s", w.Code, w.Body.String())
	}
	var result map[string]any
	json.Unmarshal(w.Body.Bytes(), &result) //nolint:errcheck
	instance := result["instance"].(map[string]any)
	if instance["status"] != "completed" {
		t.Errorf("expected completed, got %s", instance["status"])
	}
}

func TestListHumanTasks(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)
	app := newTestApp(t, pool, "http://localhost:19999")

	r := httptest.NewRequest("GET", "/v1/human-tasks", nil)
	r.Header.Set("X-Tenant-Id", tid.String())
	w := httptest.NewRecorder()
	app.ServeHTTP(w, r)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp) //nolint:errcheck
	if resp["items"] == nil {
		t.Error("expected items in response")
	}
}

func TestCompleteHumanTask(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)

	// Set up runtime mock that returns paused (human_task) on first call, then completed on resume
	callCount := 0
	rt := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		if callCount == 1 {
			// First call — paused with human task
			json.NewEncoder(w).Encode(map[string]any{
				"status":    "paused",
				"variables": map[string]any{},
				"output":    nil,
				"cursor":    "approve",
				"error":     nil,
				"steps": []any{
					map[string]any{
						"step_id": "approve", "step_type": "human_task",
						"status": "running", "input": map[string]any{},
						"output": map[string]any{"queued": true}, "error": nil, "duration_ms": 0,
					},
				},
				"human_tasks": []any{
					map[string]any{
						"step_id":  "approve",
						"assignee": "00000000-0000-0000-0000-000000000001",
						"form":     map[string]any{"prompt": "Approve?"},
					},
				},
			}) //nolint:errcheck
		} else {
			// Resume — completed
			json.NewEncoder(w).Encode(map[string]any{
				"status":      "completed",
				"variables":   map[string]any{},
				"output":      "approved",
				"cursor":      nil,
				"error":       nil,
				"steps":       []any{
					map[string]any{
						"step_id": "end", "step_type": "end",
						"status": "completed", "input": map[string]any{},
						"output": "approved", "error": nil, "duration_ms": 0,
					},
				},
				"human_tasks": []any{},
			}) //nolint:errcheck
		}
	}))
	defer rt.Close()

	app := newTestApp(t, pool, rt.URL)

	// Create def
	defBody := map[string]any{"name": "HT Complete Test"}
	data, _ := json.Marshal(defBody)
	r := httptest.NewRequest("POST", "/v1/workflows", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Tenant-Id", tid.String())
	w := httptest.NewRecorder()
	app.ServeHTTP(w, r)
	var def map[string]any
	json.Unmarshal(w.Body.Bytes(), &def) //nolint:errcheck
	defID := def["id"].(string)

	// Create version with human_task step
	dsl := map[string]any{
		"id": "v1",
		"steps": []any{
			map[string]any{"id": "approve", "type": "human_task", "assignee": "00000000-0000-0000-0000-000000000001", "form": map[string]any{"prompt": "Approve?"}},
			map[string]any{"id": "end", "type": "end"},
		},
	}
	vBody := map[string]any{"dsl": dsl}
	data, _ = json.Marshal(vBody)
	r = httptest.NewRequest("POST", "/v1/workflows/"+defID+"/versions", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Tenant-Id", tid.String())
	w = httptest.NewRecorder()
	app.ServeHTTP(w, r)

	// Publish
	pubBody := map[string]any{"rev": 1, "version": 1}
	data, _ = json.Marshal(pubBody)
	r = httptest.NewRequest("POST", "/v1/workflows/"+defID+"/publish", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Tenant-Id", tid.String())
	w = httptest.NewRecorder()
	app.ServeHTTP(w, r)

	// Start (pauses at human_task)
	startBody := map[string]any{"input": map[string]any{}}
	data, _ = json.Marshal(startBody)
	r = httptest.NewRequest("POST", "/v1/workflows/"+defID+"/start", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Tenant-Id", tid.String())
	w = httptest.NewRecorder()
	app.ServeHTTP(w, r)

	if w.Code != 201 {
		t.Fatalf("start failed: %d %s", w.Code, w.Body.String())
	}
	var startResult map[string]any
	json.Unmarshal(w.Body.Bytes(), &startResult) //nolint:errcheck

	inst := startResult["instance"].(map[string]any)
	instID := inst["id"].(string)
	if inst["status"] != string(domain.InstancePaused) {
		t.Errorf("expected paused, got %s", inst["status"])
	}

	// List human tasks for instance
	r = httptest.NewRequest("GET", "/v1/instances/"+instID+"/human-tasks", nil)
	r.Header.Set("X-Tenant-Id", tid.String())
	w = httptest.NewRecorder()
	app.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("list ht failed: %d", w.Code)
	}
	var htResp map[string]any
	json.Unmarshal(w.Body.Bytes(), &htResp) //nolint:errcheck
	htItems := htResp["items"].([]any)
	if len(htItems) == 0 {
		t.Fatal("expected at least one human task")
	}
	htID := htItems[0].(map[string]any)["id"].(string)

	// Complete human task
	compBody := map[string]any{"outcome": "approved"}
	data, _ = json.Marshal(compBody)
	r = httptest.NewRequest("POST", "/v1/human-tasks/"+htID+"/complete", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Tenant-Id", tid.String())
	w = httptest.NewRecorder()
	app.ServeHTTP(w, r)

	if w.Code != 200 {
		t.Errorf("complete failed: %d %s", w.Code, w.Body.String())
	}
}

func TestGetInstance(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)

	rt := mockRuntimeServer(t, map[string]any{
		"status":      "completed",
		"variables":   map[string]any{},
		"output":      "done",
		"cursor":      nil,
		"error":       nil,
		"steps":       []any{},
		"human_tasks": []any{},
	})
	defer rt.Close()

	app := newTestApp(t, pool, rt.URL)

	// Setup def+version+publish+start
	defBody := map[string]any{"name": "GetInstance Test"}
	data, _ := json.Marshal(defBody)
	r := httptest.NewRequest("POST", "/v1/workflows", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Tenant-Id", tid.String())
	w := httptest.NewRecorder()
	app.ServeHTTP(w, r)
	var def map[string]any
	json.Unmarshal(w.Body.Bytes(), &def) //nolint:errcheck
	defID := def["id"].(string)

	dsl := map[string]any{"id": "v1", "steps": []any{map[string]any{"id": "end", "type": "end"}}}
	data, _ = json.Marshal(map[string]any{"dsl": dsl})
	r = httptest.NewRequest("POST", "/v1/workflows/"+defID+"/versions", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Tenant-Id", tid.String())
	w = httptest.NewRecorder()
	app.ServeHTTP(w, r)

	data, _ = json.Marshal(map[string]any{"rev": 1, "version": 1})
	r = httptest.NewRequest("POST", "/v1/workflows/"+defID+"/publish", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Tenant-Id", tid.String())
	w = httptest.NewRecorder()
	app.ServeHTTP(w, r)

	data, _ = json.Marshal(map[string]any{})
	r = httptest.NewRequest("POST", "/v1/workflows/"+defID+"/start", bytes.NewReader(data))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Tenant-Id", tid.String())
	w = httptest.NewRecorder()
	app.ServeHTTP(w, r)
	var startResult map[string]any
	json.Unmarshal(w.Body.Bytes(), &startResult) //nolint:errcheck
	instID := startResult["instance"].(map[string]any)["id"].(string)

	// GET instance
	r = httptest.NewRequest("GET", "/v1/instances/"+instID, nil)
	r.Header.Set("X-Tenant-Id", tid.String())
	w = httptest.NewRecorder()
	app.ServeHTTP(w, r)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var instResp map[string]any
	json.Unmarshal(w.Body.Bytes(), &instResp) //nolint:errcheck
	if instResp["instance"] == nil {
		t.Error("expected instance in response")
	}
}
