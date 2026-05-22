package api_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/audit-svc/internal/api"
	"github.com/pmplatform/services/audit-svc/internal/service"
	"github.com/pmplatform/services/audit-svc/internal/store"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	t.Cleanup(p.Close)
	return p
}

func setupRouter(t *testing.T) (http.Handler, *pgxpool.Pool, uuid.UUID) {
	t.Helper()
	p := testPool(t)
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, $2, $3)`,
		tid, fmt.Sprintf("api-test-%s", tid.String()[:8]), "API Test")
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tid)
	})

	svc := service.New(store.New(p))
	return api.NewRouter(svc, nil), p, tid
}

func insertTestEvent(t *testing.T, p *pgxpool.Pool, tid uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	tx, _ := p.Begin(ctx)
	defer tx.Rollback(ctx) //nolint:errcheck
	_, _ = tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String()))
	_, err := tx.Exec(ctx, `
		INSERT INTO audit_log(id, tenant_id, ts, service, action, result)
		VALUES ($1::uuid, $2::uuid, $3, 'identity-svc', 'user.login', 'success')`,
		uuid.NewString(), tid.String(), time.Now().UTC())
	if err != nil {
		t.Fatalf("insert event: %v", err)
	}
	_ = tx.Commit(ctx)
}

func TestHealthz(t *testing.T) {
	handler, _, _ := setupRouter(t)
	req := httptest.NewRequest("GET", "/healthz", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestMissingTenantHeader(t *testing.T) {
	handler, _, _ := setupRouter(t)
	req := httptest.NewRequest("GET", "/v1/audit", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 400 {
		t.Fatalf("expected 400 when X-Tenant-Id missing, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListAndFilter(t *testing.T) {
	handler, p, tid := setupRouter(t)

	// Insert a test event
	insertTestEvent(t, p, tid)

	// List all events
	req := httptest.NewRequest("GET", "/v1/audit?limit=10", nil)
	req.Header.Set("X-Tenant-Id", tid.String())
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Filter by service
	req2 := httptest.NewRequest("GET", "/v1/audit?service=identity-svc", nil)
	req2.Header.Set("X-Tenant-Id", tid.String())
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)
	if w2.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w2.Code, w2.Body.String())
	}

	// Buckets
	req3 := httptest.NewRequest("GET", "/v1/audit/buckets?days=14", nil)
	req3.Header.Set("X-Tenant-Id", tid.String())
	w3 := httptest.NewRecorder()
	handler.ServeHTTP(w3, req3)
	if w3.Code != 200 {
		t.Fatalf("expected 200 for buckets, got %d: %s", w3.Code, w3.Body.String())
	}
}
