package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	libauth "github.com/pmplatform/libs/go/auth"
	libpolicy "github.com/pmplatform/libs/policy"

	"github.com/pmplatform/services/document-svc/internal/api"
	"github.com/pmplatform/services/document-svc/internal/service"
	"github.com/pmplatform/services/document-svc/internal/store"
)

// cedarTestPool prefers the project-native dev DB on :5432 but honors
// TEST_DATABASE_URL when set. Skips the test when Postgres is unreachable
// so the suite stays green on machines without the dev DB up.
func cedarTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	if err := p.Ping(context.Background()); err != nil {
		p.Close()
		t.Skipf("postgres ping failed: %v", err)
	}
	return p
}

// withClaims wraps a handler so each request carries an injected
// ParsedClaims, simulating what the JWT-bearer middleware (added later in
// Plan #4) would do. This isolates Cedar policy evaluation from JWT
// mechanics for these unit tests; the full end-to-end JWT path is
// exercised in identity-svc's cedar_rotate_test.go.
func withClaims(next http.Handler, c *libauth.ParsedClaims) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r.WithContext(libauth.WithClaims(r.Context(), c)))
	})
}

func seedCedarTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		"INSERT INTO tenant(id, slug, name, tier, status, region) VALUES ($1,$2,$3,'shared','active','us')",
		tid, "cedar-doc-"+tid.String()[:8], "Cedar Doc Test Tenant")
	if err != nil {
		t.Fatalf("seedCedarTenant: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tid)
	})
	return tid
}

func seedCedarProject(t *testing.T, p *pgxpool.Pool, tid uuid.UUID) uuid.UUID {
	t.Helper()
	pid := uuid.New()
	_, err := p.Exec(context.Background(),
		"INSERT INTO project(id, tenant_id, code, name, status, version) VALUES ($1,$2,$3,$4,'planning',1)",
		pid, tid, "CD-"+pid.String()[:4], "Cedar Doc Test Project")
	if err != nil {
		t.Fatalf("seedCedarProject: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", pid)
	})
	return pid
}

func newCedarHandler(p *pgxpool.Pool, authz libauth.Authorizer) http.Handler {
	svc := service.New(
		store.NewWorkspaces(p),
		store.NewDocuments(p),
		store.NewComments(p),
		store.NewTemplates(p),
	)
	return api.NewRouter(svc, authz)
}

// newCedarHandlerWithLoader builds the router wired with the production
// CedarLoader so the per-instance scoping tests run through the real ABAC
// path.
func newCedarHandlerWithLoader(p *pgxpool.Pool, authz libauth.Authorizer) http.Handler {
	svc := service.New(
		store.NewWorkspaces(p),
		store.NewDocuments(p),
		store.NewComments(p),
		store.NewTemplates(p),
	)
	return api.NewRouterWithLoader(svc, authz, api.NewCedarLoader(p))
}

func TestCedarGatesWorkspaceEnsure_AllowsTenantAdmin(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()
	tid := seedCedarTenant(t, p)
	pid := seedCedarProject(t, p, tid)

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	authz := &libpolicy.Adapter{Policies: ps}

	router := newCedarHandler(p, authz)
	h := withClaims(router, &libauth.ParsedClaims{
		Subject:  "sub-test-admin",
		TenantID: tid.String(),
		Roles:    []string{"tenant-admin"},
		ExpireAt: time.Now().Add(5 * time.Minute),
	})

	body, _ := json.Marshal(map[string]any{
		"project_id": pid.String(),
		"kind":       "ba",
		"name":       "Cedar Allow Workspace",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/workspaces", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-Id", tid.String())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	// ensureWorkspace returns 200 (upsert semantics), not 201.
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestCedarPerInstanceDocumentRestore_AllowsSameTenant exercises the Plan #6
// Task 6 per-instance ABAC scope: document.restore on a same-tenant
// document with the scoped loader must not 403 at the authz layer.
func TestCedarPerInstanceDocumentRestore_AllowsSameTenant(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()
	tid := seedCedarTenant(t, p)
	pid := seedCedarProject(t, p, tid)

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	authz := &libpolicy.Adapter{Policies: ps}
	router := newCedarHandlerWithLoader(p, authz)
	h := withClaims(router, &libauth.ParsedClaims{
		Subject:  "sub-test-abac",
		TenantID: tid.String(),
		Roles:    []string{"tenant-admin"},
		ExpireAt: time.Now().Add(5 * time.Minute),
	})

	// Seed a workspace + document directly so we can target an id.
	wsID := uuid.New()
	docID := uuid.New()
	tx, err := p.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, e := tx.Exec(context.Background(), "SET LOCAL app.current_tenant = '"+tid.String()+"'"); e != nil {
		t.Fatalf("set local: %v", e)
	}
	if _, e := tx.Exec(context.Background(),
		`INSERT INTO workspace(id,tenant_id,project_id,kind,name) VALUES ($1,$2,$3,'ba','WS')`,
		wsID, tid, pid); e != nil {
		t.Fatalf("seed workspace: %v", e)
	}
	if _, e := tx.Exec(context.Background(),
		`INSERT INTO document(id,tenant_id,workspace_id,project_id,type,title,body,version) VALUES ($1,$2,$3,$4,'project_charter','Doc','{}'::jsonb,1)`,
		docID, tid, wsID, pid); e != nil {
		t.Fatalf("seed document: %v", e)
	}
	if e := tx.Commit(context.Background()); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), "DELETE FROM document WHERE id=$1", docID)
		_, _ = p.Exec(context.Background(), "DELETE FROM workspace WHERE id=$1", wsID)
	})

	body, _ := json.Marshal(map[string]any{"rev": 0, "version": 1})
	req := httptest.NewRequest(http.MethodPost, "/v1/documents/"+docID.String()+"/restore", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-Id", tid.String())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	// 403 from the authz layer would be a regression; any other status is a
	// downstream concern (no rev 0 → 404 from the handler, e.g.).
	if rec.Code == http.StatusForbidden {
		t.Fatalf("scoped authz unexpectedly blocked same-tenant restore: %s", rec.Body.String())
	}
}

func TestCedarGatesWorkspaceEnsure_Denies403WithoutAllowedRole(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()
	tid := seedCedarTenant(t, p)
	pid := seedCedarProject(t, p, tid)

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	authz := &libpolicy.Adapter{Policies: ps}

	router := newCedarHandler(p, authz)
	// mfg-operator has no permit for document.workspace.ensure in the
	// shared bundle.
	h := withClaims(router, &libauth.ParsedClaims{
		Subject:  "sub-test-mfg",
		TenantID: tid.String(),
		Roles:    []string{"mfg-operator"},
		ExpireAt: time.Now().Add(5 * time.Minute),
	})

	body, _ := json.Marshal(map[string]any{
		"project_id": pid.String(),
		"kind":       "ba",
		"name":       "Cedar Deny Workspace",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/workspaces", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-Id", tid.String())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403 got %d: %s", rec.Code, rec.Body.String())
	}
}
