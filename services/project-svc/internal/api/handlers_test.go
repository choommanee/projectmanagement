package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/project-svc/internal/api"
	"github.com/pmplatform/services/project-svc/internal/service"
	"github.com/pmplatform/services/project-svc/internal/store"
)

func openTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5433/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	return p
}

func seedTestTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		"INSERT INTO tenant(id, slug, name, tier, status, region) VALUES ($1,$2,$3,'shared','active','us')",
		tid, "apitest-"+tid.String()[:8], "API Test Tenant")
	if err != nil {
		t.Fatalf("seedTestTenant: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tid)
	})
	return tid
}

func newTestServer(t *testing.T, p *pgxpool.Pool) http.Handler {
	t.Helper()
	svc := service.New(store.NewProjects(p), store.NewTasks(p), store.NewSprints(p))
	return api.NewRouter(svc)
}

func doJSON(t *testing.T, h http.Handler, method, path string, body any, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func TestHealthz(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	h := newTestServer(t, p)

	rr := doJSON(t, h, "GET", "/healthz", nil, nil)
	if rr.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestMissingTenantHeader(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	h := newTestServer(t, p)

	rr := doJSON(t, h, "GET", "/v1/projects", nil, nil)
	if rr.Code != 400 {
		t.Fatalf("expected 400 for missing X-Tenant-Id, got %d", rr.Code)
	}
}

func TestCreateProject(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)

	body := map[string]any{"code": "HTTP-001", "name": "HTTP Test Project"}
	rr := doJSON(t, h, "POST", "/v1/projects", body, map[string]string{"X-Tenant-Id": tid.String()})
	if rr.Code != 201 {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	id, ok := resp["ID"].(string)
	if !ok || id == "" {
		t.Fatalf("no ID in response: %v", resp)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", id)
	})
}

func TestListProjects(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)

	// Create two projects
	body1 := map[string]any{"code": "LST-001", "name": "List Project 1"}
	body2 := map[string]any{"code": "LST-002", "name": "List Project 2"}
	rr1 := doJSON(t, h, "POST", "/v1/projects", body1, map[string]string{"X-Tenant-Id": tid.String()})
	rr2 := doJSON(t, h, "POST", "/v1/projects", body2, map[string]string{"X-Tenant-Id": tid.String()})
	var r1, r2 map[string]any
	_ = json.Unmarshal(rr1.Body.Bytes(), &r1)
	_ = json.Unmarshal(rr2.Body.Bytes(), &r2)
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", r1["ID"])
		p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", r2["ID"])
	})

	rr := doJSON(t, h, "GET", "/v1/projects", nil, map[string]string{"X-Tenant-Id": tid.String()})
	if rr.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var listResp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &listResp)
	if int(listResp["total"].(float64)) < 2 {
		t.Fatalf("expected at least 2 projects, got total=%v", listResp["total"])
	}
}

func TestCreateGetPatchDeleteProject(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)

	headers := map[string]string{"X-Tenant-Id": tid.String()}

	// Create
	body := map[string]any{"code": "CGD-001", "name": "CGD Project", "description": "initial"}
	rr := doJSON(t, h, "POST", "/v1/projects", body, headers)
	if rr.Code != 201 {
		t.Fatalf("Create: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	id := proj["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", id) })

	// Get
	rr = doJSON(t, h, "GET", "/v1/projects/"+id, nil, headers)
	if rr.Code != 200 {
		t.Fatalf("Get: expected 200, got %d", rr.Code)
	}

	// Patch
	patch := map[string]any{"name": "CGD Updated", "version": 1}
	rr = doJSON(t, h, "PATCH", "/v1/projects/"+id, patch, headers)
	if rr.Code != 200 {
		t.Fatalf("Patch: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var patched map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &patched)
	if patched["Name"] != "CGD Updated" {
		t.Fatalf("expected updated name, got %v", patched["Name"])
	}

	// Patch with stale version → 409
	patch2 := map[string]any{"name": "Stale", "version": 1}
	rr = doJSON(t, h, "PATCH", "/v1/projects/"+id, patch2, headers)
	if rr.Code != 409 {
		t.Fatalf("Stale patch: expected 409, got %d", rr.Code)
	}

	// Delete
	rr = doJSON(t, h, "DELETE", fmt.Sprintf("/v1/projects/%s?version=2", id), nil, headers)
	if rr.Code != 204 {
		t.Fatalf("Delete: expected 204, got %d: %s", rr.Code, rr.Body.String())
	}

	// Get after delete → 404
	rr = doJSON(t, h, "GET", "/v1/projects/"+id, nil, headers)
	if rr.Code != 404 {
		t.Fatalf("Get after delete: expected 404, got %d", rr.Code)
	}
}

func TestCreateTaskUnderProject(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)

	headers := map[string]string{"X-Tenant-Id": tid.String()}

	// Create project
	projBody := map[string]any{"code": "CT-P001", "name": "Task Parent Project"}
	rr := doJSON(t, h, "POST", "/v1/projects", projBody, headers)
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	// Create task
	taskBody := map[string]any{"code": "CT-T001", "title": "HTTP Created Task", "estimate_md": 2.0}
	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks", taskBody, headers)
	if rr.Code != 201 {
		t.Fatalf("Create task: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var task map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &task)
	tid2 := task["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", tid2) })

	// List tasks
	rr = doJSON(t, h, "GET", "/v1/projects/"+pid+"/tasks", nil, headers)
	if rr.Code != 200 {
		t.Fatalf("List tasks: expected 200, got %d", rr.Code)
	}
	var listResp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &listResp)
	if int(listResp["total"].(float64)) < 1 {
		t.Fatalf("expected at least 1 task")
	}
}

func TestAssignTaskToSprint(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)

	headers := map[string]string{"X-Tenant-Id": tid.String()}

	// Create project
	rr := doJSON(t, h, "POST", "/v1/projects", map[string]any{"code": "SP-P001", "name": "Sprint Test Project"}, headers)
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	// Create task
	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks", map[string]any{"code": "SP-T001", "title": "Sprint Task"}, headers)
	var task map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &task)
	taskID := task["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", taskID) })

	// Create sprint
	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/sprints", map[string]any{"name": "Sprint 1"}, headers)
	if rr.Code != 201 {
		t.Fatalf("Create sprint: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var sprint map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &sprint)
	sprintID := sprint["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM sprint WHERE id=$1", sprintID) })

	// Assign task to sprint
	rr = doJSON(t, h, "POST", fmt.Sprintf("/v1/sprints/%s/tasks/%s", sprintID, taskID), nil, headers)
	if rr.Code != 204 {
		t.Fatalf("Assign task: expected 204, got %d: %s", rr.Code, rr.Body.String())
	}

	// Verify in DB
	var count int
	p.QueryRow(context.Background(), "SELECT count(*) FROM sprint_task WHERE sprint_id=$1 AND task_id=$2", sprintID, taskID).Scan(&count)
	if count != 1 {
		t.Fatal("task not assigned to sprint in DB")
	}

	// Unassign
	rr = doJSON(t, h, "DELETE", fmt.Sprintf("/v1/sprints/%s/tasks/%s", sprintID, taskID), nil, headers)
	if rr.Code != 204 {
		t.Fatalf("Unassign task: expected 204, got %d", rr.Code)
	}
}
