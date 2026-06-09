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
	svc.Worklog = store.NewWorklogStore(p)
	// Pass nil authz so RequireAction becomes a no-op (libs/go/auth contract)
	// and legacy tests keep working without minting JWT claims. The real
	// Cedar allow/deny grid is exercised in cedar_create_test.go.
	return api.NewRouter(svc, nil)
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
	id, ok := resp["id"].(string)
	if !ok || id == "" {
		t.Fatalf("no id in response: %v", resp)
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
		p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", r1["id"])
		p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", r2["id"])
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
	id := proj["id"].(string)
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
	if patched["name"] != "CGD Updated" {
		t.Fatalf("expected updated name, got %v", patched["name"])
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
	pid := proj["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	// Create task
	taskBody := map[string]any{"code": "CT-T001", "title": "HTTP Created Task", "estimate_md": 2.0}
	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks", taskBody, headers)
	if rr.Code != 201 {
		t.Fatalf("Create task: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var task map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &task)
	tid2 := task["id"].(string)
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

// TestListTasksRoleFilters exercises the role-workspace task filters added to
// GET /v1/tasks: type, tag (array-overlap), and reviewer. Uses real Postgres.
func TestListTasksRoleFilters(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	// Parent project
	rr := doJSON(t, h, "POST", "/v1/projects", map[string]any{"code": "RF-P001", "name": "Role Filter Project"}, headers)
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	reviewer := uuid.New().String()
	// Three tasks with distinct shapes.
	mk := func(code, ttype string, tags []string, reviewerID *string) string {
		body := map[string]any{"code": code, "title": code, "type": ttype, "tags": tags}
		if reviewerID != nil {
			body["reviewer_id"] = *reviewerID
		}
		rr := doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks", body, headers)
		if rr.Code != 201 {
			t.Fatalf("create %s: expected 201, got %d: %s", code, rr.Code, rr.Body.String())
		}
		var tk map[string]any
		_ = json.Unmarshal(rr.Body.Bytes(), &tk)
		id := tk["id"].(string)
		t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", id) })
		return id
	}
	mk("RF-RISK", "risk", []string{"ba", "analysis"}, &reviewer)
	mk("RF-ARCH", "task", []string{"go", "infra"}, nil)
	mk("RF-PLAIN", "task", []string{}, nil)

	count := func(query string) int {
		rr := doJSON(t, h, "GET", "/v1/tasks?project="+pid+"&"+query, nil, headers)
		if rr.Code != 200 {
			t.Fatalf("list %q: expected 200, got %d: %s", query, rr.Code, rr.Body.String())
		}
		var resp struct {
			Items []map[string]any `json:"items"`
		}
		_ = json.Unmarshal(rr.Body.Bytes(), &resp)
		n := 0
		for _, it := range resp.Items {
			if it["project_id"] == pid {
				n++
			}
		}
		return n
	}

	if got := count("type=risk"); got != 1 {
		t.Fatalf("type=risk: expected 1, got %d", got)
	}
	if got := count("tag=ba"); got != 1 {
		t.Fatalf("tag=ba: expected 1, got %d", got)
	}
	if got := count("tag=go,analysis"); got != 2 {
		t.Fatalf("tag=go,analysis overlap: expected 2, got %d", got)
	}
	if got := count("reviewer=" + reviewer); got != 1 {
		t.Fatalf("reviewer filter: expected 1, got %d", got)
	}
}

// TestTaskCreatePatchNullableFields covers the full nullable-field contract:
// create with status/start_date/due_date/tags, patch dates, and clear
// assignee/reviewer/dates with explicit JSON null (optUUID/optDate decoding).
func TestTaskCreatePatchNullableFields(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	// Parent project
	rr := doJSON(t, h, "POST", "/v1/projects", map[string]any{"code": "NF-P001", "name": "Nullable Fields Project"}, headers)
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	// Create with status + dates + tags (previously dropped by the handler).
	assignee := uuid.New().String()
	taskBody := map[string]any{
		"code": "NF-T001", "title": "Nullable task",
		"status": "in_progress", "start_date": "2026-06-01", "due_date": "2026-06-20",
		"tags": []string{"alpha", "beta"}, "assignee_id": assignee,
	}
	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks", taskBody, headers)
	if rr.Code != 201 {
		t.Fatalf("Create task: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var task map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &task)
	taskID := task["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", taskID) })
	if task["status"] != "in_progress" {
		t.Fatalf("create dropped status: got %v", task["status"])
	}
	if task["start_date"] == nil || task["due_date"] == nil {
		t.Fatalf("create dropped dates: start=%v due=%v", task["start_date"], task["due_date"])
	}
	if tags, _ := task["tags"].([]any); len(tags) != 2 {
		t.Fatalf("create dropped tags: %v", task["tags"])
	}

	// Invalid status is rejected.
	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks",
		map[string]any{"code": "NF-T002", "title": "bad status", "status": "bogus"}, headers)
	if rr.Code != 400 {
		t.Fatalf("invalid status: expected 400, got %d: %s", rr.Code, rr.Body.String())
	}

	// Patch dates (previously not updatable).
	rr = doJSON(t, h, "PATCH", "/v1/tasks/"+taskID,
		map[string]any{"start_date": "2026-06-05", "due_date": "2026-07-01", "version": 1}, headers)
	if rr.Code != 200 {
		t.Fatalf("Patch dates: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var patched map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &patched)
	if sd, _ := patched["start_date"].(string); sd[:10] != "2026-06-05" {
		t.Fatalf("start_date not patched: %v", patched["start_date"])
	}

	// Explicit JSON null clears assignee + due_date (previously a silent no-op).
	req := []byte(`{"assignee_id":null,"due_date":null,"version":2}`)
	hr := httptest.NewRequest("PATCH", "/v1/tasks/"+taskID, bytes.NewReader(req))
	hr.Header.Set("Content-Type", "application/json")
	hr.Header.Set("X-Tenant-Id", tid.String())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, hr)
	if rec.Code != 200 {
		t.Fatalf("null clear: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var cleared map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &cleared)
	if cleared["assignee_id"] != nil {
		t.Fatalf("assignee_id not cleared by explicit null: %v", cleared["assignee_id"])
	}
	if cleared["due_date"] != nil {
		t.Fatalf("due_date not cleared by explicit null: %v", cleared["due_date"])
	}
	if sd, _ := cleared["start_date"].(string); sd[:10] != "2026-06-05" {
		t.Fatalf("start_date should be untouched by absent field: %v", cleared["start_date"])
	}
}

// TestProjectPatchClearFields covers explicit clear of description/due_date
// and setting start_date through PATCH /v1/projects/{id}.
func TestProjectPatchClearFields(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	rr := doJSON(t, h, "POST", "/v1/projects",
		map[string]any{"code": "PC-P001", "name": "Clear Project", "description": "to be cleared"}, headers)
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	// Set start_date + due_date.
	rr = doJSON(t, h, "PATCH", "/v1/projects/"+pid,
		map[string]any{"start_date": "2026-06-02", "due_date": "2026-08-01", "version": 1}, headers)
	if rr.Code != 200 {
		t.Fatalf("set dates: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	// Clear description ("") and due_date (null); start_date untouched.
	body := []byte(`{"description":"","due_date":null,"version":2}`)
	hr := httptest.NewRequest("PATCH", "/v1/projects/"+pid, bytes.NewReader(body))
	hr.Header.Set("Content-Type", "application/json")
	hr.Header.Set("X-Tenant-Id", tid.String())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, hr)
	if rec.Code != 200 {
		t.Fatalf("clear: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var cleared map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &cleared)
	if cleared["description"] != "" {
		t.Fatalf("description not cleared: %v", cleared["description"])
	}
	if cleared["due_date"] != nil {
		t.Fatalf("due_date not cleared: %v", cleared["due_date"])
	}
	if sd, _ := cleared["start_date"].(string); sd[:10] != "2026-06-02" {
		t.Fatalf("start_date should be untouched: %v", cleared["start_date"])
	}
}

func TestGetSprintHTTP(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	// Create project
	rr := doJSON(t, h, "POST", "/v1/projects", map[string]any{"code": "GSP-001", "name": "GetSprint Project"}, headers)
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	// Create sprint
	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/sprints", map[string]any{"name": "GetSprint S1", "goal": "Test goal"}, headers)
	if rr.Code != 201 {
		t.Fatalf("Create sprint: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var sprint map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &sprint)
	sprintID := sprint["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM sprint WHERE id=$1", sprintID) })

	// GET /v1/sprints/:id
	rr = doJSON(t, h, "GET", "/v1/sprints/"+sprintID, nil, headers)
	if rr.Code != 200 {
		t.Fatalf("GetSprint: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if got["id"].(string) != sprintID {
		t.Fatalf("expected sprint ID %s, got %v", sprintID, got["id"])
	}
	if got["name"] != "GetSprint S1" {
		t.Fatalf("expected name 'GetSprint S1', got %v", got["name"])
	}
}

func TestListSprintTasksHTTP(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	// Create project
	rr := doJSON(t, h, "POST", "/v1/projects", map[string]any{"code": "LST-S01", "name": "ListSprintTasks Project"}, headers)
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	// Create task
	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks", map[string]any{"code": "LST-T01", "title": "List Sprint Task"}, headers)
	var task map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &task)
	taskID := task["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", taskID) })

	// Create sprint
	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/sprints", map[string]any{"name": "List Tasks Sprint"}, headers)
	var sprint map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &sprint)
	sprintID := sprint["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM sprint WHERE id=$1", sprintID) })

	// List tasks before assign → empty
	rr = doJSON(t, h, "GET", fmt.Sprintf("/v1/sprints/%s/tasks", sprintID), nil, headers)
	if rr.Code != 200 {
		t.Fatalf("ListSprintTasks before assign: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var listResp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &listResp)
	if int(listResp["total"].(float64)) != 0 {
		t.Fatalf("expected 0 tasks before assign, got %v", listResp["total"])
	}

	// Assign task
	rr = doJSON(t, h, "POST", fmt.Sprintf("/v1/sprints/%s/tasks/%s", sprintID, taskID), nil, headers)
	if rr.Code != 204 {
		t.Fatalf("Assign: expected 204, got %d", rr.Code)
	}

	// List tasks after assign → 1
	rr = doJSON(t, h, "GET", fmt.Sprintf("/v1/sprints/%s/tasks", sprintID), nil, headers)
	if rr.Code != 200 {
		t.Fatalf("ListSprintTasks after assign: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &listResp)
	if int(listResp["total"].(float64)) != 1 {
		t.Fatalf("expected 1 task after assign, got %v", listResp["total"])
	}
}

func TestListWorklogs(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	// Create project + task
	rr := doJSON(t, h, "POST", "/v1/projects", map[string]any{"code": "WL-P001", "name": "Worklog Project"}, headers)
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks", map[string]any{"code": "WL-T001", "title": "Worklog Task"}, headers)
	var task map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &task)
	taskID := task["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", taskID) })

	// POST a worklog entry
	userID := uuid.New().String()
	wlBody := map[string]any{
		"user_id":   userID,
		"logged_md": 0.5,
		"work_date": "2026-05-25",
		"note":      "half day review",
	}
	rr = doJSON(t, h, "POST", "/v1/tasks/"+taskID+"/worklogs", wlBody, headers)
	if rr.Code != 201 {
		t.Fatalf("POST worklog: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var entry map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &entry)
	if entry["id"] == nil || entry["id"] == "" {
		t.Fatalf("expected id in worklog response, got %v", entry)
	}

	// GET /tasks/{id}/worklogs
	rr = doJSON(t, h, "GET", "/v1/tasks/"+taskID+"/worklogs", nil, headers)
	if rr.Code != 200 {
		t.Fatalf("GET worklogs: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var listResp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &listResp)
	if int(listResp["total"].(float64)) < 1 {
		t.Fatalf("expected at least 1 worklog entry, got total=%v", listResp["total"])
	}
}

func TestCreateWorklog_InvalidLoggedMd(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	// Create project + task
	rr := doJSON(t, h, "POST", "/v1/projects", map[string]any{"code": "WLV-P01", "name": "Worklog Val Project"}, headers)
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks", map[string]any{"code": "WLV-T01", "title": "Worklog Val Task"}, headers)
	var task map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &task)
	taskID := task["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", taskID) })

	// POST with logged_md = -1 → 400
	userID := uuid.New().String()
	wlBody := map[string]any{
		"user_id":   userID,
		"logged_md": -1.0,
		"work_date": "2026-05-25",
		"note":      "invalid",
	}
	rr = doJSON(t, h, "POST", "/v1/tasks/"+taskID+"/worklogs", wlBody, headers)
	if rr.Code != 400 {
		t.Fatalf("expected 400 for negative logged_md, got %d: %s", rr.Code, rr.Body.String())
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
	pid := proj["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	// Create task
	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks", map[string]any{"code": "SP-T001", "title": "Sprint Task"}, headers)
	var task map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &task)
	taskID := task["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", taskID) })

	// Create sprint
	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/sprints", map[string]any{"name": "Sprint 1"}, headers)
	if rr.Code != 201 {
		t.Fatalf("Create sprint: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var sprint map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &sprint)
	sprintID := sprint["id"].(string)
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
