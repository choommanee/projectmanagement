package api_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/notification-svc/internal/api"
	"github.com/pmplatform/services/notification-svc/internal/service"
	"github.com/pmplatform/services/notification-svc/internal/store"
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

func setupRouter(t *testing.T) (http.Handler, *store.Store, uuid.UUID, uuid.UUID) {
	t.Helper()
	p := testPool(t)
	tid := uuid.New()
	uid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, $2, $3)`,
		tid, fmt.Sprintf("notif-api-%s", tid.String()[:8]), "Notif API Test")
	if err != nil {
		t.Skipf("seed tenant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tid)
	})
	st := store.New(p)
	return api.NewRouter(service.New(st), nil), st, tid, uid
}

func TestHealthz(t *testing.T) {
	handler, _, _, _ := setupRouter(t)
	req := httptest.NewRequest("GET", "/healthz", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestMissingHeaders(t *testing.T) {
	handler, _, _, _ := setupRouter(t)
	req := httptest.NewRequest("GET", "/v1/notifications", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 400 {
		t.Fatalf("expected 400 without headers, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListAndMarkRead(t *testing.T) {
	handler, st, tid, uid := setupRouter(t)

	id1, err := st.Insert(context.Background(), store.InsertParams{
		TenantID: tid, UserID: uid, Kind: "task.assigned", Title: "first",
	})
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	_, _ = st.Insert(context.Background(), store.InsertParams{
		TenantID: tid, UserID: uid, Kind: "task.assigned", Title: "second",
	})

	// List
	req := httptest.NewRequest("GET", "/v1/notifications?limit=10", nil)
	req.Header.Set("X-Tenant-Id", tid.String())
	req.Header.Set("X-User-Id", uid.String())
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("list: %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(resp.Items))
	}

	// Mark one read
	req2 := httptest.NewRequest("POST", "/v1/notifications/"+id1+"/read", nil)
	req2.Header.Set("X-Tenant-Id", tid.String())
	req2.Header.Set("X-User-Id", uid.String())
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)
	if w2.Code != 200 {
		t.Fatalf("mark read: %d: %s", w2.Code, w2.Body.String())
	}

	// Unread filter should now return 1.
	req3 := httptest.NewRequest("GET", "/v1/notifications?unread=true", nil)
	req3.Header.Set("X-Tenant-Id", tid.String())
	req3.Header.Set("X-User-Id", uid.String())
	w3 := httptest.NewRecorder()
	handler.ServeHTTP(w3, req3)
	if w3.Code != 200 {
		t.Fatalf("list unread: %d", w3.Code)
	}
	var resp2 struct {
		Items []map[string]any `json:"items"`
	}
	_ = json.Unmarshal(w3.Body.Bytes(), &resp2)
	if len(resp2.Items) != 1 {
		t.Fatalf("expected 1 unread, got %d", len(resp2.Items))
	}
}

func TestMarkAllRead(t *testing.T) {
	handler, st, tid, uid := setupRouter(t)

	for i := 0; i < 3; i++ {
		_, _ = st.Insert(context.Background(), store.InsertParams{
			TenantID: tid, UserID: uid, Kind: "k", Title: fmt.Sprintf("n%d", i),
		})
	}
	req := httptest.NewRequest("POST", "/v1/notifications/read-all", nil)
	req.Header.Set("X-Tenant-Id", tid.String())
	req.Header.Set("X-User-Id", uid.String())
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("read-all: %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Updated int64 `json:"updated"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Updated != 3 {
		t.Fatalf("expected 3 updated, got %d", resp.Updated)
	}
}

func TestMarkRead_InvalidID(t *testing.T) {
	handler, _, tid, uid := setupRouter(t)
	req := httptest.NewRequest("POST", "/v1/notifications/not-a-uuid/read", nil)
	req.Header.Set("X-Tenant-Id", tid.String())
	req.Header.Set("X-User-Id", uid.String())
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
