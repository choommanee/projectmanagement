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

	"github.com/pmplatform/services/quality-svc/internal/api"
	"github.com/pmplatform/services/quality-svc/internal/service"
	"github.com/pmplatform/services/quality-svc/internal/store"
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
		"INSERT INTO tenant(id, slug, name) VALUES ($1,$2,$3)",
		tid, "cedar-quality-"+tid.String()[:8], "Cedar Quality Test Tenant")
	if err != nil {
		t.Fatalf("seedCedarTenant: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tid)
	})
	return tid
}

func newCedarHandler(p *pgxpool.Pool, authz libauth.Authorizer) http.Handler {
	svc := service.New(
		store.NewAPQP(p),
		store.NewPPAP(p),
		store.NewFMEA(p),
		store.NewControlPlan(p),
		store.NewInspection(p),
		store.NewNCR(p),
	)
	return api.NewRouter(svc, authz)
}

// newCedarHandlerWithLoader wires the CedarLoader for per-instance ABAC
// tests so the loader path is exercised end-to-end.
func newCedarHandlerWithLoader(p *pgxpool.Pool, authz libauth.Authorizer) http.Handler {
	svc := service.New(
		store.NewAPQP(p),
		store.NewPPAP(p),
		store.NewFMEA(p),
		store.NewControlPlan(p),
		store.NewInspection(p),
		store.NewNCR(p),
	)
	return api.NewRouterWithLoader(svc, authz, api.NewCedarLoader(p))
}

func TestCedarGatesAPQPCreate_AllowsQualityEngineer(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()
	tid := seedCedarTenant(t, p)

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	authz := &libpolicy.Adapter{Policies: ps}

	router := newCedarHandler(p, authz)
	h := withClaims(router, &libauth.ParsedClaims{
		Subject:  "sub-test-quality-eng",
		TenantID: tid.String(),
		Roles:    []string{"quality-engineer"},
		ExpireAt: time.Now().Add(5 * time.Minute),
	})

	body, _ := json.Marshal(map[string]any{
		"name": "Cedar Allow APQP",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/apqp", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-Id", tid.String())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201 got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestCedarPerInstanceAPQPUpdate_AllowsSameTenant exercises the Plan #6
// Task 6 per-instance ABAC scope on a same-tenant APQP update.
func TestCedarPerInstanceAPQPUpdate_AllowsSameTenant(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()
	tid := seedCedarTenant(t, p)

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	authz := &libpolicy.Adapter{Policies: ps}
	router := newCedarHandlerWithLoader(p, authz)
	h := withClaims(router, &libauth.ParsedClaims{
		Subject:  "sub-q-abac",
		TenantID: tid.String(),
		Roles:    []string{"tenant-admin"},
		ExpireAt: time.Now().Add(5 * time.Minute),
	})

	// Seed an apqp row directly.
	apqpID := uuid.New()
	tx, err := p.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, e := tx.Exec(context.Background(), "SET LOCAL app.current_tenant = '"+tid.String()+"'"); e != nil {
		t.Fatal(e)
	}
	if _, e := tx.Exec(context.Background(),
		`INSERT INTO apqp_project(id,tenant_id,name,version) VALUES ($1,$2,$3,1)`,
		apqpID, tid, "ABAC APQP"); e != nil {
		t.Fatalf("seed apqp: %v", e)
	}
	if e := tx.Commit(context.Background()); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), "DELETE FROM apqp_project WHERE id=$1", apqpID)
	})

	body, _ := json.Marshal(map[string]any{"name": "Renamed", "version": 1})
	req := httptest.NewRequest(http.MethodPatch, "/v1/apqp/"+apqpID.String(), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-Id", tid.String())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code == http.StatusForbidden {
		t.Fatalf("scoped authz unexpectedly blocked same-tenant APQP update: %s", rec.Body.String())
	}
}

func TestCedarGatesAPQPCreate_Denies403WithoutAllowedRole(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()
	tid := seedCedarTenant(t, p)

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	authz := &libpolicy.Adapter{Policies: ps}

	router := newCedarHandler(p, authz)
	// mfg-operator has no permit for quality.apqp.create in the shared
	// bundle.
	h := withClaims(router, &libauth.ParsedClaims{
		Subject:  "sub-test-mfg-op",
		TenantID: tid.String(),
		Roles:    []string{"mfg-operator"},
		ExpireAt: time.Now().Add(5 * time.Minute),
	})

	body, _ := json.Marshal(map[string]any{
		"name": "Cedar Deny APQP",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/apqp", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-Id", tid.String())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403 got %d: %s", rec.Code, rec.Body.String())
	}
}
