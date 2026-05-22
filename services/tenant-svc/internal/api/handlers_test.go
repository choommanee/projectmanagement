package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
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
	// nil authz -> libauth.RequireAction is a no-op for these legacy
	// unit tests. cedar_create_test.go exercises the real Cedar adapter
	// against the shared bundle.
	return NewRouter(service.New(store.New(p)), nil), p, func() { p.Close() }
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

func TestListTenantsHTTP(t *testing.T) {
	h, p, cleanup := newRouter(t)
	defer cleanup()
	// Seed
	marker := uuid.NewString()[:6]
	for i := 0; i < 2; i++ {
		body, _ := json.Marshal(map[string]string{"slug": "lst-" + marker + "-" + strconv.Itoa(i), "name": "L" + strconv.Itoa(i)})
		req := httptest.NewRequest(http.MethodPost, "/v1/tenants", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(httptest.NewRecorder(), req)
	}
	defer p.Exec(context.Background(), "DELETE FROM tenant WHERE slug LIKE $1", "lst-"+marker+"%")

	req := httptest.NewRequest(http.MethodGet, "/v1/tenants?q=lst-"+marker, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("got %d", rec.Code)
	}
	var body struct {
		Items []map[string]any `json:"items"`
		Total int              `json:"total"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if body.Total != 2 || len(body.Items) != 2 {
		t.Fatalf("got %d items / total %d", len(body.Items), body.Total)
	}
}

func TestUpdateTenantHTTP(t *testing.T) {
	h, p, cleanup := newRouter(t)
	defer cleanup()
	slug := "upd-" + uuid.NewString()[:6]
	body, _ := json.Marshal(map[string]string{"slug": slug, "name": "Original"})
	req := httptest.NewRequest(http.MethodPost, "/v1/tenants", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var created map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	id := created["ID"]
	if id == nil {
		id = created["id"]
	}
	ver := 1
	defer p.Exec(context.Background(), "DELETE FROM tenant WHERE slug=$1", slug)

	upd, _ := json.Marshal(map[string]any{"name": "Updated", "version": ver})
	req2 := httptest.NewRequest(http.MethodPatch, "/v1/tenants/"+id.(string), bytes.NewReader(upd))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != 200 {
		t.Fatalf("got %d: %s", rec2.Code, rec2.Body.String())
	}
	var u map[string]any
	_ = json.Unmarshal(rec2.Body.Bytes(), &u)
	name := u["Name"]
	if name == nil {
		name = u["name"]
	}
	if name != "Updated" {
		t.Fatalf("name not updated: %v", name)
	}
}

func TestDeleteTenantHTTP(t *testing.T) {
	h, p, cleanup := newRouter(t)
	defer cleanup()
	slug := "del-" + uuid.NewString()[:6]
	body, _ := json.Marshal(map[string]string{"slug": slug, "name": "Doomed"})
	req := httptest.NewRequest(http.MethodPost, "/v1/tenants", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var created map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	id := created["ID"]
	if id == nil {
		id = created["id"]
	}
	defer p.Exec(context.Background(), "DELETE FROM tenant WHERE slug=$1", slug)

	req2 := httptest.NewRequest(http.MethodDelete, "/v1/tenants/"+id.(string)+"?version=1", nil)
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != 204 {
		t.Fatalf("got %d: %s", rec2.Code, rec2.Body.String())
	}

	req3 := httptest.NewRequest(http.MethodGet, "/v1/tenants/"+id.(string), nil)
	rec3 := httptest.NewRecorder()
	h.ServeHTTP(rec3, req3)
	if rec3.Code != 404 {
		t.Fatalf("expected 404 after delete, got %d", rec3.Code)
	}
}
