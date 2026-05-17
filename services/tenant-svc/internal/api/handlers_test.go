package api

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

	"github.com/pmplatform/services/tenant-svc/internal/service"
	"github.com/pmplatform/services/tenant-svc/internal/store"
)

func newRouter(t *testing.T) (http.Handler, *pgxpool.Pool, func()) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5433/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skip(err)
	}
	return NewRouter(service.New(store.New(p))), p, func() { p.Close() }
}

func TestCreateTenantHTTP(t *testing.T) {
	h, p, cleanup := newRouter(t)
	defer cleanup()

	slug := "tcli-" + uuid.NewString()[:6]
	body, _ := json.Marshal(map[string]string{"slug": slug, "name": "Test Co"})
	req := httptest.NewRequest(http.MethodPost, "/v1/tenants", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("got %d: %s", rec.Code, rec.Body.String())
	}
	_, _ = p.Exec(context.Background(), "DELETE FROM tenant WHERE slug=$1", slug)
}

func TestCreateRejectsBadSlug(t *testing.T) {
	h, _, cleanup := newRouter(t)
	defer cleanup()
	body, _ := json.Marshal(map[string]string{"slug": "BAD SLUG", "name": "X"})
	req := httptest.NewRequest(http.MethodPost, "/v1/tenants", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestGetBySlugFound(t *testing.T) {
	h, p, cleanup := newRouter(t)
	defer cleanup()
	slug := "gs-" + uuid.NewString()[:6]
	body, _ := json.Marshal(map[string]string{"slug": slug, "name": "G"})
	_ = body
	// seed via API
	req := httptest.NewRequest(http.MethodPost, "/v1/tenants", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	req2 := httptest.NewRequest(http.MethodGet, "/v1/tenants/by-slug/"+slug, nil)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != 200 {
		t.Fatalf("want 200, got %d: %s", rec2.Code, rec2.Body.String())
	}
	_, _ = p.Exec(context.Background(), "DELETE FROM tenant WHERE slug=$1", slug)
}
