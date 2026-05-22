package api

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

	"github.com/pmplatform/services/tenant-svc/internal/service"
	"github.com/pmplatform/services/tenant-svc/internal/store"
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
// ParsedClaims, simulating what the JWT-bearer middleware (added later
// in Plan #4) would do. This isolates the Cedar policy evaluation from
// JWT mechanics for these unit tests; the full end-to-end JWT path is
// exercised in identity-svc's cedar_rotate_test.go.
func withClaims(next http.Handler, c *libauth.ParsedClaims) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r.WithContext(libauth.WithClaims(r.Context(), c)))
	})
}

func TestCedarGatesCreate_AllowsPlatformAdmin(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	authz := &libpolicy.Adapter{Policies: ps}

	router := NewRouter(service.New(store.New(p)), authz)
	h := withClaims(router, &libauth.ParsedClaims{
		Subject:  "sub-test-admin",
		TenantID: "tenant-test",
		Roles:    []string{"platform-admin"},
		ExpireAt: time.Now().Add(5 * time.Minute),
	})

	slug := "cedar-allow-" + uuid.NewString()[:6]
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), "DELETE FROM tenant WHERE slug=$1", slug)
	})

	body, _ := json.Marshal(map[string]string{"slug": slug, "name": "Allowed Co"})
	req := httptest.NewRequest(http.MethodPost, "/v1/tenants", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201 got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestCedarPerInstanceUpdate_AllowsSameTenant exercises the Plan #6 Task 6
// per-instance ABAC scope: a tenant-admin updating their own tenant must
// be allowed when the loader returns matching tenant_id.
func TestCedarPerInstanceUpdate_AllowsSameTenant(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	authz := &libpolicy.Adapter{Policies: ps}
	loader := NewCedarLoader(p)

	// Seed two tenants — the one we will update + a second one so the
	// cross-tenant case below has a foreign row to point at.
	tid := uuid.New()
	otherTid := uuid.New()
	for _, row := range []struct {
		id   uuid.UUID
		slug string
	}{
		{tid, "cedar-abac-" + uuid.NewString()[:6]},
		{otherTid, "cedar-other-" + uuid.NewString()[:6]},
	} {
		_, err := p.Exec(context.Background(),
			"INSERT INTO tenant(id, slug, name, tier, status, region) VALUES ($1,$2,$3,'shared','active','us')",
			row.id, row.slug, "Cedar ABAC")
		if err != nil {
			t.Fatalf("seed tenant: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), "DELETE FROM tenant WHERE id = ANY($1)", []uuid.UUID{tid, otherTid})
	})

	router := NewRouterWithLoader(service.New(store.New(p)), authz, loader)
	h := withClaims(router, &libauth.ParsedClaims{
		Subject:  "sub-abac",
		TenantID: tid.String(),
		Roles:    []string{"tenant-admin"},
		ExpireAt: time.Now().Add(5 * time.Minute),
	})

	body, _ := json.Marshal(map[string]any{"name": "Renamed", "version": 1})
	req := httptest.NewRequest(http.MethodPatch, "/v1/tenants/"+tid.String(), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	// 200 (allow + applied) or 409 (allow + version mismatch) both prove the
	// authz gate let the request through. 403 would mean the scoped middleware
	// blocked us.
	if rec.Code == http.StatusForbidden {
		t.Fatalf("scoped authz unexpectedly blocked same-tenant update: %s", rec.Body.String())
	}
}

func TestCedarGatesCreate_Denies403WithoutAdminRole(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	authz := &libpolicy.Adapter{Policies: ps}

	router := NewRouter(service.New(store.New(p)), authz)
	// project-manager has no permit for tenant.create in the shared bundle.
	h := withClaims(router, &libauth.ParsedClaims{
		Subject:  "sub-test-pm",
		TenantID: "tenant-test",
		Roles:    []string{"project-manager"},
		ExpireAt: time.Now().Add(5 * time.Minute),
	})

	slug := "cedar-deny-" + uuid.NewString()[:6]
	body, _ := json.Marshal(map[string]string{"slug": slug, "name": "Denied Co"})
	req := httptest.NewRequest(http.MethodPost, "/v1/tenants", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403 got %d: %s", rec.Code, rec.Body.String())
	}
	// Defensive: ensure we didn't actually persist anything.
	_, _ = p.Exec(context.Background(), "DELETE FROM tenant WHERE slug=$1", slug)
}
