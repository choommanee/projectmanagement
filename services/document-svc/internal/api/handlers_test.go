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

	"github.com/pmplatform/services/document-svc/internal/api"
	"github.com/pmplatform/services/document-svc/internal/service"
	"github.com/pmplatform/services/document-svc/internal/store"
)

func openTestPool(t *testing.T) *pgxpool.Pool {
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

func seedTestProject(t *testing.T, p *pgxpool.Pool, tid uuid.UUID) uuid.UUID {
	t.Helper()
	pid := uuid.New()
	_, err := p.Exec(context.Background(),
		"INSERT INTO project(id, tenant_id, code, name, status, version) VALUES ($1,$2,$3,$4,'planning',1)",
		pid, tid, "AP-"+pid.String()[:4], "API Test Project")
	if err != nil {
		t.Fatalf("seedTestProject: %v", err)
	}
	return pid
}

func newTestHandler(p *pgxpool.Pool) http.Handler {
	svc := service.New(
		store.NewWorkspaces(p),
		store.NewDocuments(p),
		store.NewComments(p),
		store.NewTemplates(p),
	)
	// Pass nil authz so libauth.RequireAction becomes a no-op; these legacy
	// tests don't mint JWTs / inject claims, and Cedar coverage lives in
	// cedar_create_test.go.
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
	h := newTestHandler(p)

	rr := doJSON(t, h, "GET", "/healthz", nil, nil)
	if rr.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]string
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["status"] != "ok" {
		t.Fatalf("expected status=ok, got %v", resp)
	}
}

func TestMissingTenantHeader(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	h := newTestHandler(p)

	// No X-Tenant-Id header
	rr := doJSON(t, h, "GET", "/v1/documents", nil, nil)
	if rr.Code != 400 {
		t.Fatalf("expected 400 for missing X-Tenant-Id, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestCreateDocumentHTTP(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	pid := seedTestProject(t, p, tid)
	h := newTestHandler(p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}
	ctx := context.Background()

	// First ensure a workspace
	wsResp := doJSON(t, h, "POST", "/v1/workspaces", map[string]any{
		"project_id": pid.String(), "kind": "ba", "name": "BA Workspace",
	}, headers)
	if wsResp.Code != 200 {
		t.Fatalf("ensure workspace: expected 200, got %d: %s", wsResp.Code, wsResp.Body.String())
	}
	var ws map[string]any
	_ = json.Unmarshal(wsResp.Body.Bytes(), &ws)
	if _, ok := ws["id"].(string); !ok {
		t.Fatalf("workspace response missing snake_case id: %v", ws)
	}
	for _, k := range []string{"id", "tenant_id", "project_id", "kind", "name", "created_at"} {
		if _, ok := ws[k]; !ok {
			t.Fatalf("workspace response missing snake_case key %q: %v", k, ws)
		}
	}
	wsID := ws["id"].(string)

	// Create document
	body := map[string]any{
		"workspace_id": wsID,
		"project_id":   pid.String(),
		"type":         "brd",
		"title":        "HTTP BRD Test",
		"body":         map[string]any{"type": "doc", "content": []any{}},
	}
	rr := doJSON(t, h, "POST", "/v1/documents", body, headers)
	if rr.Code != 201 {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var doc map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &doc)
	docID, ok := doc["id"].(string)
	if !ok || docID == "" {
		t.Fatalf("no snake_case id in response: %v", doc)
	}
	// Assert the full snake_case contract on the create response.
	for _, k := range []string{"id", "workspace_id", "project_id", "current_version_id", "created_at"} {
		if _, ok := doc[k]; !ok {
			t.Fatalf("create document response missing snake_case key %q: %v", k, doc)
		}
	}
	// Ensure no PascalCase leakage.
	for _, k := range []string{"ID", "WorkspaceID", "ProjectID", "CurrentVersionID", "CreatedAt"} {
		if _, ok := doc[k]; ok {
			t.Fatalf("create document response leaked PascalCase key %q: %v", k, doc)
		}
	}
	t.Cleanup(func() {
		p.Exec(ctx, "DELETE FROM document WHERE id=$1", docID)
	})

	// Verify it's retrievable and also snake_case
	rr = doJSON(t, h, "GET", "/v1/documents/"+docID, nil, headers)
	if rr.Code != 200 {
		t.Fatalf("get document: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	for _, k := range []string{"id", "workspace_id", "project_id", "current_version_id", "created_at"} {
		if _, ok := got[k]; !ok {
			t.Fatalf("get document response missing snake_case key %q: %v", k, got)
		}
	}
	if _, ok := got["ID"]; ok {
		t.Fatalf("get document response leaked PascalCase ID: %v", got)
	}
}

func TestListDocumentsHTTP(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	pid := seedTestProject(t, p, tid)
	h := newTestHandler(p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}
	ctx := context.Background()

	// Ensure workspace
	wsResp := doJSON(t, h, "POST", "/v1/workspaces", map[string]any{
		"project_id": pid.String(), "kind": "sa", "name": "SA Workspace",
	}, headers)
	var ws map[string]any
	_ = json.Unmarshal(wsResp.Body.Bytes(), &ws)
	wsID := ws["id"].(string)

	// Create two documents
	for i, title := range []string{"Doc Alpha", "Doc Beta"} {
		rr := doJSON(t, h, "POST", "/v1/documents", map[string]any{
			"workspace_id": wsID,
			"project_id":   pid.String(),
			"type":         "adr",
			"title":        title,
		}, headers)
		if rr.Code != 201 {
			t.Fatalf("create doc %d: expected 201, got %d: %s", i, rr.Code, rr.Body.String())
		}
		var d map[string]any
		_ = json.Unmarshal(rr.Body.Bytes(), &d)
		id := d["id"].(string)
		t.Cleanup(func() { p.Exec(ctx, "DELETE FROM document WHERE id=$1", id) })
	}

	// List filtered by workspace_id
	rr := doJSON(t, h, "GET", "/v1/documents?workspace_id="+wsID, nil, headers)
	if rr.Code != 200 {
		t.Fatalf("list: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var listResp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &listResp)
	total := int(listResp["total"].(float64))
	if total < 2 {
		t.Fatalf("expected total >= 2, got %d", total)
	}
}

func TestPatchDocumentCreatesNewVersionHTTP(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	pid := seedTestProject(t, p, tid)
	h := newTestHandler(p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}
	ctx := context.Background()

	// Workspace
	wsResp := doJSON(t, h, "POST", "/v1/workspaces", map[string]any{
		"project_id": pid.String(), "kind": "pm", "name": "PM Workspace",
	}, headers)
	var ws map[string]any
	_ = json.Unmarshal(wsResp.Body.Bytes(), &ws)
	wsID := ws["id"].(string)

	// Create document
	createResp := doJSON(t, h, "POST", "/v1/documents", map[string]any{
		"workspace_id": wsID,
		"project_id":   pid.String(),
		"type":         "project_charter",
		"title":        "Charter v1",
	}, headers)
	if createResp.Code != 201 {
		t.Fatalf("create: expected 201, got %d: %s", createResp.Code, createResp.Body.String())
	}
	var doc map[string]any
	_ = json.Unmarshal(createResp.Body.Bytes(), &doc)
	docID := doc["id"].(string)
	t.Cleanup(func() { p.Exec(ctx, "DELETE FROM document WHERE id=$1", docID) })

	// Verify version list has 1 entry
	versResp := doJSON(t, h, "GET", "/v1/documents/"+docID+"/versions", nil, headers)
	if versResp.Code != 200 {
		t.Fatalf("list versions: expected 200, got %d", versResp.Code)
	}
	var vList map[string]any
	_ = json.Unmarshal(versResp.Body.Bytes(), &vList)
	if int(vList["total"].(float64)) != 1 {
		t.Fatalf("expected 1 version after create, got %v", vList["total"])
	}

	// Patch document
	patchResp := doJSON(t, h, "PATCH", "/v1/documents/"+docID, map[string]any{
		"title": "Charter v2", "version": 1,
	}, headers)
	if patchResp.Code != 200 {
		t.Fatalf("patch: expected 200, got %d: %s", patchResp.Code, patchResp.Body.String())
	}
	var patched map[string]any
	_ = json.Unmarshal(patchResp.Body.Bytes(), &patched)
	if int(patched["version"].(float64)) != 2 {
		t.Fatalf("expected version=2 after patch, got %v", patched["version"])
	}

	// Verify version list now has 2 entries
	versResp2 := doJSON(t, h, "GET", "/v1/documents/"+docID+"/versions", nil, headers)
	_ = json.Unmarshal(versResp2.Body.Bytes(), &vList)
	if int(vList["total"].(float64)) != 2 {
		t.Fatalf("expected 2 versions after patch, got %v", vList["total"])
	}

	// Stale patch → 409
	staleResp := doJSON(t, h, "PATCH", "/v1/documents/"+docID, map[string]any{
		"title": "Stale", "version": 1,
	}, headers)
	if staleResp.Code != 409 {
		t.Fatalf("stale patch: expected 409, got %d", staleResp.Code)
	}
}

func TestPatchDocumentMetadata(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	pid := seedTestProject(t, p, tid)
	h := newTestHandler(p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}
	ctx := context.Background()

	// Ensure workspace
	wsResp := doJSON(t, h, "POST", "/v1/workspaces", map[string]any{
		"project_id": pid.String(), "kind": "sa", "name": "SA Workspace",
	}, headers)
	if wsResp.Code != 200 {
		t.Fatalf("ensure workspace: expected 200, got %d: %s", wsResp.Code, wsResp.Body.String())
	}
	var ws map[string]any
	_ = json.Unmarshal(wsResp.Body.Bytes(), &ws)
	wsID := ws["id"].(string)

	// Create an ADR document
	createResp := doJSON(t, h, "POST", "/v1/documents", map[string]any{
		"workspace_id": wsID,
		"project_id":   pid.String(),
		"type":         "adr",
		"title":        "Use PostgreSQL",
	}, headers)
	if createResp.Code != 201 {
		t.Fatalf("create: expected 201, got %d: %s", createResp.Code, createResp.Body.String())
	}
	var doc map[string]any
	_ = json.Unmarshal(createResp.Body.Bytes(), &doc)
	docID := doc["id"].(string)
	t.Cleanup(func() { p.Exec(ctx, "DELETE FROM document WHERE id=$1", docID) })

	// PATCH with metadata (ADR votes)
	votes := []map[string]any{
		{"userId": "user-001", "choice": "approved", "votedAt": "2026-05-23T10:00:00Z"},
	}
	patchResp := doJSON(t, h, "PATCH", "/v1/documents/"+docID, map[string]any{
		"metadata": map[string]any{"votes": votes},
		"version":  1,
	}, headers)
	if patchResp.Code != 200 {
		t.Fatalf("patch metadata: expected 200, got %d: %s", patchResp.Code, patchResp.Body.String())
	}
	var patched map[string]any
	_ = json.Unmarshal(patchResp.Body.Bytes(), &patched)

	// Assert metadata echoed in response
	meta, ok := patched["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected metadata in response, got: %v", patched["metadata"])
	}
	votesOut, ok := meta["votes"].([]any)
	if !ok || len(votesOut) != 1 {
		t.Fatalf("expected 1 vote in metadata, got: %v", meta["votes"])
	}

	// GET to confirm metadata persisted
	getResp := doJSON(t, h, "GET", "/v1/documents/"+docID, nil, headers)
	if getResp.Code != 200 {
		t.Fatalf("get: expected 200, got %d", getResp.Code)
	}
	var fetched map[string]any
	_ = json.Unmarshal(getResp.Body.Bytes(), &fetched)
	fetchedMeta, ok := fetched["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected metadata in GET response, got: %v", fetched["metadata"])
	}
	fetchedVotes, ok := fetchedMeta["votes"].([]any)
	if !ok || len(fetchedVotes) != 1 {
		t.Fatalf("expected 1 persisted vote, got: %v", fetchedMeta["votes"])
	}
}

// TestListAllWorkspacesHTTP verifies the tenant-wide workspace list (no
// project_id) introduced for the cross-project Document Hub, plus the kind
// filter. Regression guard: the route used to 400 ("project_id required").
func TestListAllWorkspacesHTTP(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	pid := seedTestProject(t, p, tid)
	h := newTestHandler(p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	for _, k := range []string{"ba", "sa", "expert"} {
		rr := doJSON(t, h, "POST", "/v1/workspaces", map[string]any{
			"project_id": pid.String(), "kind": k, "name": k + " ws",
		}, headers)
		if rr.Code != 200 {
			t.Fatalf("ensure %s workspace: got %d: %s", k, rr.Code, rr.Body.String())
		}
	}

	// No project_id → tenant-wide list.
	rr := doJSON(t, h, "GET", "/v1/workspaces", nil, headers)
	if rr.Code != 200 {
		t.Fatalf("list all workspaces: got %d: %s", rr.Code, rr.Body.String())
	}
	var out struct {
		Items []map[string]any `json:"items"`
		Total int              `json:"total"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	if out.Total < 3 || len(out.Items) < 3 {
		t.Fatalf("expected >=3 workspaces, got total=%d len=%d", out.Total, len(out.Items))
	}
	if _, ok := out.Items[0]["id"]; !ok {
		t.Fatalf("workspace item missing snake_case id: %v", out.Items[0])
	}

	// kind filter.
	rr = doJSON(t, h, "GET", "/v1/workspaces?kind=sa", nil, headers)
	if rr.Code != 200 {
		t.Fatalf("list ws kind=sa: got %d: %s", rr.Code, rr.Body.String())
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &out)
	for _, w := range out.Items {
		if w["kind"] != "sa" {
			t.Fatalf("kind filter leaked %v", w["kind"])
		}
	}
}

// TestGetWorkspaceByIDHTTP verifies the workspace detail route (used by the
// docs workspace detail page). Regression guard: the route used to 404.
func TestGetWorkspaceByIDHTTP(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	pid := seedTestProject(t, p, tid)
	h := newTestHandler(p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	rr := doJSON(t, h, "POST", "/v1/workspaces", map[string]any{
		"project_id": pid.String(), "kind": "pm", "name": "Detail WS",
	}, headers)
	if rr.Code != 200 {
		t.Fatalf("ensure ws: got %d: %s", rr.Code, rr.Body.String())
	}
	var ws map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &ws)
	wsID := ws["id"].(string)

	rr = doJSON(t, h, "GET", "/v1/workspaces/"+wsID, nil, headers)
	if rr.Code != 200 {
		t.Fatalf("get workspace by id: got %d: %s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if got["id"] != wsID || got["name"] != "Detail WS" || got["kind"] != "pm" {
		t.Fatalf("unexpected workspace detail: %v", got)
	}

	// Unknown id → 404.
	rr = doJSON(t, h, "GET", "/v1/workspaces/"+uuid.NewString(), nil, headers)
	if rr.Code != 404 {
		t.Fatalf("expected 404 for unknown ws, got %d", rr.Code)
	}
}

// TestPatchDocumentInvalidStatus verifies a bogus status is rejected with 400
// instead of the DB enum 500 it used to produce.
func TestPatchDocumentInvalidStatus(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)
	pid := seedTestProject(t, p, tid)
	h := newTestHandler(p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}
	ctx := context.Background()

	wsResp := doJSON(t, h, "POST", "/v1/workspaces", map[string]any{
		"project_id": pid.String(), "kind": "ba", "name": "BA",
	}, headers)
	var ws map[string]any
	_ = json.Unmarshal(wsResp.Body.Bytes(), &ws)

	docResp := doJSON(t, h, "POST", "/v1/documents", map[string]any{
		"workspace_id": ws["id"], "project_id": pid.String(), "type": "brd", "title": "Status Test",
	}, headers)
	if docResp.Code != 201 {
		t.Fatalf("create doc: got %d: %s", docResp.Code, docResp.Body.String())
	}
	var doc map[string]any
	_ = json.Unmarshal(docResp.Body.Bytes(), &doc)
	docID := doc["id"].(string)
	t.Cleanup(func() { p.Exec(ctx, "DELETE FROM document WHERE id=$1", docID) })

	rr := doJSON(t, h, "PATCH", "/v1/documents/"+docID, map[string]any{
		"status": "garbage", "version": 1,
	}, headers)
	if rr.Code != 400 {
		t.Fatalf("expected 400 for invalid status, got %d: %s", rr.Code, rr.Body.String())
	}

	// A valid transition still succeeds.
	rr = doJSON(t, h, "PATCH", "/v1/documents/"+docID, map[string]any{
		"status": "review", "version": 1,
	}, headers)
	if rr.Code != 200 {
		t.Fatalf("expected 200 for valid status, got %d: %s", rr.Code, rr.Body.String())
	}
}
