package api_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	libauth "github.com/pmplatform/libs/go/auth"
	libpolicy "github.com/pmplatform/libs/policy"

	"github.com/pmplatform/services/notification-svc/internal/api"
	"github.com/pmplatform/services/notification-svc/internal/service"
	"github.com/pmplatform/services/notification-svc/internal/store"
)

// wrapClaims wraps a handler so every request carries an injected
// ParsedClaims, simulating what the JWT-bearer middleware would do.
// This isolates Cedar evaluation from JWT mechanics for smoke tests.
func wrapClaims(next http.Handler, c *libauth.ParsedClaims) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r.WithContext(libauth.WithClaims(r.Context(), c)))
	})
}

// TestCedarGatesNotifRead_AllowsProjectManager verifies that a
// project-manager (which has a notif.read permit in the shared Cedar bundle)
// can GET /v1/notifications and receives 200 (Cedar allow).
//
// The test passes authz=non-nil so the Cedar middleware is active; claims are
// injected via WithClaims so no real JWT round-trip is needed.
func TestCedarGatesNotifRead_AllowsProjectManager(t *testing.T) {
	p := testPool(t)

	tid := uuid.New()
	_, err := p.Exec(context.Background(), `INSERT INTO tenant(id, slug, name) VALUES ($1,$2,$3)`,
		tid, "cedar-notif-"+tid.String()[:8], "Cedar Notif Test")
	if err != nil {
		t.Skipf("seed tenant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id=$1`, tid)
	})

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	authz := &libpolicy.Adapter{Policies: ps}

	st := store.New(p)
	router := api.NewRouter(service.New(st), authz)

	uid := uuid.New()
	claims := &libauth.ParsedClaims{
		Subject:  uid.String(),
		TenantID: tid.String(),
		Roles:    []string{"project-manager"},
		ExpireAt: time.Now().Add(5 * time.Minute),
	}
	h := wrapClaims(router, claims)

	req := httptest.NewRequest(http.MethodGet, "/v1/notifications", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 (Cedar allow) got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestCedarGatesNotifRead_Denies401WithoutClaims verifies that when no JWT
// claims are present in context the Cedar middleware returns 401 before
// reaching the handler. This exercises the "missing claims" guard in
// RequireAction.
func TestCedarGatesNotifRead_Denies401WithoutClaims(t *testing.T) {
	p := testPool(t)

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	authz := &libpolicy.Adapter{Policies: ps}

	st := store.New(p)
	router := api.NewRouter(service.New(st), authz)

	// No wrapClaims — no JWT claims in context.
	req := httptest.NewRequest(http.MethodGet, "/v1/notifications", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 (missing claims) got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestCedarGatesMarkAllRead_AllowsProjectManager verifies that a
// project-manager (notif.mark_all_read permit) calling POST
// /v1/notifications/read-all is allowed at the Cedar layer (200 or 404,
// never 403).
func TestCedarGatesMarkAllRead_AllowsProjectManager(t *testing.T) {
	p := testPool(t)

	tid := uuid.New()
	_, err := p.Exec(context.Background(), `INSERT INTO tenant(id, slug, name) VALUES ($1,$2,$3)`,
		tid, "cedar-mark-all-"+tid.String()[:8], "Cedar MarkAll Test")
	if err != nil {
		t.Skipf("seed tenant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id=$1`, tid)
	})

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	authz := &libpolicy.Adapter{Policies: ps}

	st := store.New(p)
	router := api.NewRouter(service.New(st), authz)

	uid := uuid.New()
	claims := &libauth.ParsedClaims{
		Subject:  uid.String(),
		TenantID: tid.String(),
		Roles:    []string{"project-manager"},
		ExpireAt: time.Now().Add(5 * time.Minute),
	}
	h := wrapClaims(router, claims)

	req := httptest.NewRequest(http.MethodPost, "/v1/notifications/read-all", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	// Cedar allow — handler returns 200 (0 rows updated is fine) or possibly
	// 404 depending on implementation. A 403 would indicate a Cedar deny.
	if rec.Code == http.StatusForbidden {
		t.Fatalf("want Cedar allow (200/404) got 403: %s", rec.Body.String())
	}
}
