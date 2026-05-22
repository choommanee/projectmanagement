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
	wsID := ws["ID"].(string)

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
	docID, ok := doc["ID"].(string)
	if !ok || docID == "" {
		t.Fatalf("no ID in response: %v", doc)
	}
	t.Cleanup(func() {
		p.Exec(ctx, "DELETE FROM document WHERE id=$1", docID)
	})

	// Verify it's retrievable
	rr = doJSON(t, h, "GET", "/v1/documents/"+docID, nil, headers)
	if rr.Code != 200 {
		t.Fatalf("get document: expected 200, got %d: %s", rr.Code, rr.Body.String())
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
	wsID := ws["ID"].(string)

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
		id := d["ID"].(string)
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
	wsID := ws["ID"].(string)

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
	docID := doc["ID"].(string)
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
	if int(patched["Version"].(float64)) != 2 {
		t.Fatalf("expected Version=2 after patch, got %v", patched["Version"])
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
