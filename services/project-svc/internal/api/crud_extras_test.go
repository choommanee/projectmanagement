package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/project-svc/internal/api"
	"github.com/pmplatform/services/project-svc/internal/service"
	"github.com/pmplatform/services/project-svc/internal/store"
)

// newServerWithActivity wires the full service surface (incl. Activity) with a
// no-op authorizer so these tests exercise handler + store + real Postgres.
func newServerWithActivity(t *testing.T, p *pgxpool.Pool) http.Handler {
	t.Helper()
	svc := service.New(store.NewProjects(p), store.NewTasks(p), store.NewSprints(p))
	svc.Worklog = store.NewWorklogStore(p)
	svc.WithActivity(store.NewActivity(p))
	return api.NewRouter(svc, nil)
}

// seedProjectTask creates a project + task and returns their ids, registering cleanup.
func seedProjectTask(t *testing.T, h http.Handler, p *pgxpool.Pool, tid uuid.UUID, prefix string) (string, string) {
	t.Helper()
	headers := map[string]string{"X-Tenant-Id": tid.String()}
	rr := doJSON(t, h, "POST", "/v1/projects", map[string]any{"code": prefix + "-P", "name": prefix + " Project"}, headers)
	if rr.Code != 201 {
		t.Fatalf("seed project: %d %s", rr.Code, rr.Body.String())
	}
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks", map[string]any{"code": prefix + "-T", "title": prefix + " Task"}, headers)
	if rr.Code != 201 {
		t.Fatalf("seed task: %d %s", rr.Code, rr.Body.String())
	}
	var task map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &task)
	return pid, task["id"].(string)
}

func TestSprintSoftDelete(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	rr := doJSON(t, h, "POST", "/v1/projects", map[string]any{"code": "SSD-P", "name": "Soft Del Project"}, headers)
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/sprints", map[string]any{"name": "Sprint X"}, headers)
	if rr.Code != 201 {
		t.Fatalf("create sprint: %d %s", rr.Code, rr.Body.String())
	}
	var sp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &sp)
	sid := sp["id"].(string)
	if int(sp["version"].(float64)) != 1 {
		t.Fatalf("expected version 1, got %v", sp["version"])
	}

	// Delete without version → 400
	rr = doJSON(t, h, "DELETE", "/v1/sprints/"+sid, nil, headers)
	if rr.Code != 400 {
		t.Fatalf("delete without version: expected 400, got %d", rr.Code)
	}

	// Soft-delete with correct version → 204
	rr = doJSON(t, h, "DELETE", "/v1/sprints/"+sid+"?version=1", nil, headers)
	if rr.Code != 204 {
		t.Fatalf("soft delete: expected 204, got %d: %s", rr.Code, rr.Body.String())
	}

	// Row still present in DB but deleted_at set.
	var deletedAt *string
	_ = p.QueryRow(context.Background(), "SELECT deleted_at::text FROM sprint WHERE id=$1", sid).Scan(&deletedAt)
	if deletedAt == nil {
		t.Fatalf("expected deleted_at set after soft delete")
	}

	// GET should 404 (excluded by deleted_at filter).
	rr = doJSON(t, h, "GET", "/v1/sprints/"+sid, nil, headers)
	if rr.Code != 404 {
		t.Fatalf("get after delete: expected 404, got %d", rr.Code)
	}

	// List must exclude it.
	rr = doJSON(t, h, "GET", "/v1/projects/"+pid+"/sprints", nil, headers)
	var listResp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &listResp)
	if int(listResp["total"].(float64)) != 0 {
		t.Fatalf("expected 0 sprints after soft delete, got %v", listResp["total"])
	}
}

func TestSprintDeleteVersionConflict(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	rr := doJSON(t, h, "POST", "/v1/projects", map[string]any{"code": "SVC-P", "name": "P"}, headers)
	var proj map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &proj)
	pid := proj["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid) })

	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/sprints", map[string]any{"name": "S"}, headers)
	var sp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &sp)
	sid := sp["id"].(string)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM sprint WHERE id=$1", sid) })

	rr = doJSON(t, h, "DELETE", "/v1/sprints/"+sid+"?version=99", nil, headers)
	if rr.Code != 409 {
		t.Fatalf("stale version delete: expected 409, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestCommentEditDelete(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newServerWithActivity(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	_, taskID := seedProjectTask(t, h, p, tid, "CMT")

	authorID := uuid.New().String()
	rr := doJSON(t, h, "POST", "/v1/tasks/"+taskID+"/comments",
		map[string]any{"body": "first comment", "author_id": authorID}, headers)
	if rr.Code != 201 {
		t.Fatalf("create comment: %d %s", rr.Code, rr.Body.String())
	}
	var c map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &c)
	cid := c["id"].(string)
	if c["author_id"] != authorID {
		t.Fatalf("expected author_id %s, got %v", authorID, c["author_id"])
	}
	if int(c["version"].(float64)) != 1 {
		t.Fatalf("expected version 1, got %v", c["version"])
	}

	// Edit with correct version.
	rr = doJSON(t, h, "PATCH", "/v1/comments/"+cid, map[string]any{"body": "edited comment", "version": 1}, headers)
	if rr.Code != 200 {
		t.Fatalf("patch comment: %d %s", rr.Code, rr.Body.String())
	}
	var updated map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &updated)
	if updated["body"] != "edited comment" {
		t.Fatalf("expected edited body, got %v", updated["body"])
	}
	if int(updated["version"].(float64)) != 2 {
		t.Fatalf("expected version 2 after edit, got %v", updated["version"])
	}

	// Stale version edit → 409.
	rr = doJSON(t, h, "PATCH", "/v1/comments/"+cid, map[string]any{"body": "stale", "version": 1}, headers)
	if rr.Code != 409 {
		t.Fatalf("stale edit: expected 409, got %d", rr.Code)
	}

	// Delete without version → 400.
	rr = doJSON(t, h, "DELETE", "/v1/comments/"+cid, nil, headers)
	if rr.Code != 400 {
		t.Fatalf("delete without version: expected 400, got %d", rr.Code)
	}

	// Soft-delete with correct version (now 2) → 204.
	rr = doJSON(t, h, "DELETE", "/v1/comments/"+cid+"?version=2", nil, headers)
	if rr.Code != 204 {
		t.Fatalf("delete comment: %d %s", rr.Code, rr.Body.String())
	}

	// List must exclude the deleted comment.
	rr = doJSON(t, h, "GET", "/v1/tasks/"+taskID+"/comments", nil, headers)
	var listResp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &listResp)
	if int(listResp["total"].(float64)) != 0 {
		t.Fatalf("expected 0 comments after delete, got %v", listResp["total"])
	}
}

func TestWorklogEditDelete(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	_, taskID := seedProjectTask(t, h, p, tid, "WLE")

	userID := uuid.New().String()
	rr := doJSON(t, h, "POST", "/v1/tasks/"+taskID+"/worklogs",
		map[string]any{"user_id": userID, "logged_md": 1.0, "work_date": "2026-05-25", "note": "init"}, headers)
	if rr.Code != 201 {
		t.Fatalf("create worklog: %d %s", rr.Code, rr.Body.String())
	}
	var e map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &e)
	wid := e["id"].(string)
	if int(e["version"].(float64)) != 1 {
		t.Fatalf("expected version 1, got %v", e["version"])
	}

	// Edit logged_md + note.
	rr = doJSON(t, h, "PATCH", "/v1/worklogs/"+wid,
		map[string]any{"logged_md": 2.5, "note": "revised", "version": 1}, headers)
	if rr.Code != 200 {
		t.Fatalf("patch worklog: %d %s", rr.Code, rr.Body.String())
	}
	var upd map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &upd)
	if upd["logged_md"].(float64) != 2.5 || upd["note"] != "revised" {
		t.Fatalf("worklog not updated: %v", upd)
	}
	if int(upd["version"].(float64)) != 2 {
		t.Fatalf("expected version 2, got %v", upd["version"])
	}

	// Invalid logged_md → 400.
	rr = doJSON(t, h, "PATCH", "/v1/worklogs/"+wid, map[string]any{"logged_md": 0, "version": 2}, headers)
	if rr.Code != 400 {
		t.Fatalf("invalid logged_md: expected 400, got %d", rr.Code)
	}

	// Soft-delete with version 2 → 204.
	rr = doJSON(t, h, "DELETE", "/v1/worklogs/"+wid+"?version=2", nil, headers)
	if rr.Code != 204 {
		t.Fatalf("delete worklog: %d %s", rr.Code, rr.Body.String())
	}

	// List excludes deleted.
	rr = doJSON(t, h, "GET", "/v1/tasks/"+taskID+"/worklogs", nil, headers)
	var listResp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &listResp)
	if int(listResp["total"].(float64)) != 0 {
		t.Fatalf("expected 0 worklogs after delete, got %v", listResp["total"])
	}
}

func TestDependencyTypeAndLag(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	pid, succID := seedProjectTask(t, h, p, tid, "DEP")

	// Second task (predecessor).
	rr := doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks",
		map[string]any{"code": "DEP-T2", "title": "Predecessor"}, headers)
	var task2 map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &task2)
	predID := task2["id"].(string)

	// Add dependency with explicit type + lag.
	rr = doJSON(t, h, "POST", "/v1/tasks/"+succID+"/dependencies",
		map[string]any{"predecessor_id": predID, "type": "ss", "lag_days": 3}, headers)
	if rr.Code != 201 {
		t.Fatalf("add dependency: %d %s", rr.Code, rr.Body.String())
	}
	var dep map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &dep)
	if dep["type"] != "ss" || int(dep["lag_days"].(float64)) != 3 {
		t.Fatalf("dep type/lag wrong: %v", dep)
	}
	if dep["predecessor_id"] != predID || dep["successor_id"] != succID {
		t.Fatalf("dep ids wrong: %v", dep)
	}

	// Add a second dependency omitting type → defaults to "fs".
	rr = doJSON(t, h, "POST", "/v1/projects/"+pid+"/tasks",
		map[string]any{"code": "DEP-T3", "title": "Pred2"}, headers)
	var task3 map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &task3)
	pred2 := task3["id"].(string)
	rr = doJSON(t, h, "POST", "/v1/tasks/"+succID+"/dependencies",
		map[string]any{"predecessor_id": pred2}, headers)
	var dep2 map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &dep2)
	if dep2["type"] != "fs" {
		t.Fatalf("expected default type fs, got %v", dep2["type"])
	}

	// GET project deps returns type + lag in snake_case envelope.
	rr = doJSON(t, h, "GET", "/v1/projects/"+pid+"/task-dependencies", nil, headers)
	if rr.Code != 200 {
		t.Fatalf("list deps: %d %s", rr.Code, rr.Body.String())
	}
	var depList map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &depList)
	items := depList["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("expected 2 deps, got %d", len(items))
	}
	found := false
	for _, it := range items {
		m := it.(map[string]any)
		if m["type"] == "ss" && int(m["lag_days"].(float64)) == 3 {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected to find ss/lag=3 dep in list: %v", items)
	}
}
