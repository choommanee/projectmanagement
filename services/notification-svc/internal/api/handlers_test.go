package api_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	libauth "github.com/pmplatform/libs/go/auth"

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
	svc := service.New(st).WithPreferences(store.NewPreference(p))
	return api.NewRouter(svc, nil), st, tid, uid
}

// withClaims injects a fake JWT principal into the request context so the
// principalOr400 helper can extract tenant + user without a live JWKS server.
func withClaims(r *http.Request, tid, uid uuid.UUID) *http.Request {
	claims := &libauth.ParsedClaims{
		TenantID: tid.String(),
		Subject:  uid.String(),
	}
	return r.WithContext(libauth.WithClaims(r.Context(), claims))
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

func TestMissingClaims(t *testing.T) {
	handler, _, _, _ := setupRouter(t)
	// No claims in context — expect 401.
	req := httptest.NewRequest("GET", "/v1/notifications", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 401 {
		t.Fatalf("expected 401 without claims, got %d: %s", w.Code, w.Body.String())
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
	req := withClaims(httptest.NewRequest("GET", "/v1/notifications?limit=10", nil), tid, uid)
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
	req2 := withClaims(httptest.NewRequest("POST", "/v1/notifications/"+id1+"/read", nil), tid, uid)
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)
	if w2.Code != 200 {
		t.Fatalf("mark read: %d: %s", w2.Code, w2.Body.String())
	}

	// Unread filter should now return 1.
	req3 := withClaims(httptest.NewRequest("GET", "/v1/notifications?unread=true", nil), tid, uid)
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
	req := withClaims(httptest.NewRequest("POST", "/v1/notifications/read-all", nil), tid, uid)
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
	req := withClaims(httptest.NewRequest("POST", "/v1/notifications/not-a-uuid/read", nil), tid, uid)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 400 {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestListReturnsTotal(t *testing.T) {
	handler, st, tid, uid := setupRouter(t)
	for i := 0; i < 3; i++ {
		_, _ = st.Insert(context.Background(), store.InsertParams{
			TenantID: tid, UserID: uid, Kind: "k", Title: fmt.Sprintf("n%d", i),
		})
	}
	// limit=1 → 1 item but total must reflect all 3.
	req := withClaims(httptest.NewRequest("GET", "/v1/notifications?limit=1", nil), tid, uid)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("list: %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Items []map[string]any `json:"items"`
		Total int              `json:"total"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Items) != 1 {
		t.Fatalf("expected 1 item (limit), got %d", len(resp.Items))
	}
	if resp.Total != 3 {
		t.Fatalf("expected total 3, got %d", resp.Total)
	}
}

func TestPreferences_RoundTrip(t *testing.T) {
	handler, _, tid, uid := setupRouter(t)

	// Initially empty.
	req := withClaims(httptest.NewRequest("GET", "/v1/notification-preferences", nil), tid, uid)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("get prefs: %d: %s", w.Code, w.Body.String())
	}
	var empty struct {
		Preferences []map[string]any `json:"preferences"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &empty)
	if len(empty.Preferences) != 0 {
		t.Fatalf("expected 0 prefs, got %d", len(empty.Preferences))
	}

	// PUT a bare array.
	body := `[{"kind":"task.assigned","channels":["inapp","email"]},{"kind":"task.blocked","channels":["inapp"]}]`
	req2 := withClaims(httptest.NewRequest("PUT", "/v1/notification-preferences", strings.NewReader(body)), tid, uid)
	req2.Header.Set("content-type", "application/json")
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)
	if w2.Code != 200 {
		t.Fatalf("put prefs: %d: %s", w2.Code, w2.Body.String())
	}

	// GET reflects the saved set.
	req3 := withClaims(httptest.NewRequest("GET", "/v1/notification-preferences", nil), tid, uid)
	w3 := httptest.NewRecorder()
	handler.ServeHTTP(w3, req3)
	var got struct {
		Preferences []struct {
			Kind     string   `json:"kind"`
			Channels []string `json:"channels"`
		} `json:"preferences"`
	}
	if err := json.Unmarshal(w3.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode prefs: %v", err)
	}
	if len(got.Preferences) != 2 {
		t.Fatalf("expected 2 prefs, got %d: %s", len(got.Preferences), w3.Body.String())
	}
	byKind := map[string][]string{}
	for _, p := range got.Preferences {
		byKind[p.Kind] = p.Channels
	}
	if got := byKind["task.assigned"]; len(got) != 2 {
		t.Fatalf("task.assigned channels = %v, want 2", got)
	}
	if got := byKind["task.blocked"]; len(got) != 1 || got[0] != "inapp" {
		t.Fatalf("task.blocked channels = %v, want [inapp]", got)
	}

	// PUT again with updated channels → idempotent upsert.
	body2 := `{"preferences":[{"kind":"task.assigned","channels":["email"]}]}`
	req4 := withClaims(httptest.NewRequest("PUT", "/v1/notification-preferences", strings.NewReader(body2)), tid, uid)
	req4.Header.Set("content-type", "application/json")
	w4 := httptest.NewRecorder()
	handler.ServeHTTP(w4, req4)
	if w4.Code != 200 {
		t.Fatalf("put prefs (wrapped): %d: %s", w4.Code, w4.Body.String())
	}
}

func TestPreferences_MissingClaims(t *testing.T) {
	handler, _, _, _ := setupRouter(t)
	req := httptest.NewRequest("GET", "/v1/notification-preferences", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != 401 {
		t.Fatalf("expected 401 without claims, got %d", w.Code)
	}
}
