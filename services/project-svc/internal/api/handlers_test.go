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
	pid := proj["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	// Create sprint
	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/sprints", map[string]any{"name": "GetSprint S1", "goal": "Test goal"}, headers)
	if rr.Code != 201 {
		t.Fatalf("Create sprint: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var sprint map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &sprint)
	sprintID := sprint["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM sprint WHERE id=$1", sprintID) })

	// GET /v1/sprints/:id
	rr = doJSON(t, h, "GET", "/v1/sprints/"+sprintID, nil, headers)
	if rr.Code != 200 {
		t.Fatalf("GetSprint: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if got["ID"].(string) != sprintID {
		t.Fatalf("expected sprint ID %s, got %v", sprintID, got["ID"])
	}
	if got["Name"] != "GetSprint S1" {
		t.Fatalf("expected name 'GetSprint S1', got %v", got["Name"])
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
	pid := proj["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	// Create task
	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks", map[string]any{"code": "LST-T01", "title": "List Sprint Task"}, headers)
	var task map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &task)
	taskID := task["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", taskID) })

	// Create sprint
	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/sprints", map[string]any{"name": "List Tasks Sprint"}, headers)
	var sprint map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &sprint)
	sprintID := sprint["ID"].(string)
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

func TestTaskPlanningFieldsRoundTripHTTP(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	rr := doJSON(t, h, "POST", "/v1/projects", map[string]any{"code": "TPF-001", "name": "Task Planning Fields"}, headers)
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	assignee := uuid.NewString()
	reviewer := uuid.NewString()
	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks", map[string]any{
		"code":        "TPF-T001",
		"title":       "Planning Task",
		"status":      "in_progress",
		"assignee_id": assignee,
		"reviewer_id": reviewer,
		"estimate_md": 4.5,
		"start_date":  "2026-06-01",
		"due_date":    "2026-06-07",
		"tags":        []string{"plan", "timeline"},
	}, headers)
	if rr.Code != 201 {
		t.Fatalf("Create task: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var task map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &task)
	taskID := task["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", taskID) })

	if got := task["Status"]; got != "in_progress" {
		t.Fatalf("expected status in_progress, got %v", got)
	}
	if got := task["AssigneeID"]; got != assignee {
		t.Fatalf("expected assignee %s, got %v", assignee, got)
	}
	if got := task["ReviewerID"]; got != reviewer {
		t.Fatalf("expected reviewer %s, got %v", reviewer, got)
	}
	if got := task["StartDate"].(string); got[:10] != "2026-06-01" {
		t.Fatalf("expected start_date 2026-06-01, got %s", got)
	}
	if got := task["DueDate"].(string); got[:10] != "2026-06-07" {
		t.Fatalf("expected due_date 2026-06-07, got %s", got)
	}
}

func TestUpdateTaskCanClearOptionalPlanningFieldsHTTP(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	rr := doJSON(t, h, "POST", "/v1/projects", map[string]any{"code": "UTC-001", "name": "Update Task Clear"}, headers)
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks", map[string]any{
		"code":        "UTC-T001",
		"title":       "Task with optional fields",
		"assignee_id": uuid.NewString(),
		"reviewer_id": uuid.NewString(),
		"start_date":  "2026-07-01",
		"due_date":    "2026-07-10",
	}, headers)
	var task map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &task)
	taskID := task["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM task WHERE id=$1", taskID) })

	rr = doJSON(t, h, "PATCH", "/v1/tasks/"+taskID, map[string]any{
		"assignee_id": nil,
		"reviewer_id": nil,
		"start_date":  nil,
		"due_date":    nil,
		"version":     1,
	}, headers)
	if rr.Code != 200 {
		t.Fatalf("Patch clear: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var patched map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &patched)
	if patched["AssigneeID"] != nil {
		t.Fatalf("expected assignee cleared, got %v", patched["AssigneeID"])
	}
	if patched["ReviewerID"] != nil {
		t.Fatalf("expected reviewer cleared, got %v", patched["ReviewerID"])
	}
	if patched["StartDate"] != nil {
		t.Fatalf("expected start_date cleared, got %v", patched["StartDate"])
	}
	if patched["DueDate"] != nil {
		t.Fatalf("expected due_date cleared, got %v", patched["DueDate"])
	}
}

func TestSprintPlanningFieldsAndValidationHTTP(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	rr := doJSON(t, h, "POST", "/v1/projects", map[string]any{"code": "SPF-001", "name": "Sprint Planning Fields"}, headers)
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/sprints", map[string]any{
		"name":         "Iteration 1",
		"status":       "active",
		"start_date":   "2026-08-01",
		"end_date":     "2026-08-14",
		"capacity_pts": 42,
	}, headers)
	if rr.Code != 201 {
		t.Fatalf("Create sprint: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var sprint map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &sprint)
	sprintID := sprint["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM sprint WHERE id=$1", sprintID) })

	if got := sprint["Status"]; got != "active" {
		t.Fatalf("expected active status, got %v", got)
	}
	if got := sprint["CapacityPts"]; got != float64(42) {
		t.Fatalf("expected capacity 42, got %v", got)
	}
	if got := sprint["StartDate"].(string); got[:10] != "2026-08-01" {
		t.Fatalf("expected start_date 2026-08-01, got %s", got)
	}
	if got := sprint["EndDate"].(string); got[:10] != "2026-08-14" {
		t.Fatalf("expected end_date 2026-08-14, got %s", got)
	}

	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/sprints", map[string]any{
		"name":       "Invalid Window",
		"start_date": "2026-08-20",
		"end_date":   "2026-08-10",
	}, headers)
	if rr.Code != 400 {
		t.Fatalf("Create invalid sprint: expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestProjectPlanningFieldsCanSetAndClearHTTP(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	rr := doJSON(t, h, "POST", "/v1/projects", map[string]any{"code": "PRP-001", "name": "Project Planning Patch"}, headers)
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	owner := uuid.NewString()
	rr = doJSON(t, h, "PATCH", "/v1/projects/"+pid, map[string]any{
		"owner_id":     owner,
		"start_date":   "2026-09-01",
		"due_date":     "2026-09-30",
		"progress_pct": 30,
		"version":      1,
	}, headers)
	if rr.Code != 200 {
		t.Fatalf("Patch set fields: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var patched map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &patched)
	if patched["OwnerID"] != owner {
		t.Fatalf("expected owner set, got %v", patched["OwnerID"])
	}

	rr = doJSON(t, h, "PATCH", "/v1/projects/"+pid, map[string]any{
		"owner_id":   nil,
		"start_date": nil,
		"due_date":   nil,
		"version":    2,
	}, headers)
	if rr.Code != 200 {
		t.Fatalf("Patch clear fields: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &patched)
	if patched["OwnerID"] != nil || patched["StartDate"] != nil || patched["DueDate"] != nil {
		t.Fatalf("expected owner/start/due cleared, got owner=%v start=%v due=%v", patched["OwnerID"], patched["StartDate"], patched["DueDate"])
	}
}

func TestTaskPlanValidationHTTP(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	rr := doJSON(t, h, "POST", "/v1/projects", map[string]any{"code": "TPV-001", "name": "Task Plan Validation"}, headers)
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["ID"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks", map[string]any{
		"code":        "TPV-T1",
		"title":       "Invalid negative md",
		"estimate_md": -1,
	}, headers)
	if rr.Code != 400 {
		t.Fatalf("negative estimate: expected 400, got %d: %s", rr.Code, rr.Body.String())
	}

	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks", map[string]any{
		"code":       "TPV-T2",
		"title":      "Invalid date range",
		"start_date": "2026-10-10",
		"due_date":   "2026-10-01",
	}, headers)
	if rr.Code != 400 {
		t.Fatalf("invalid date range: expected 400, got %d: %s", rr.Code, rr.Body.String())
	}
}
