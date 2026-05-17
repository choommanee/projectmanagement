package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBaseServerAddsRequestID(t *testing.T) {
	h := NewBaseRouter()
	h.Get("/x", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/x", nil)
	h.ServeHTTP(rec, req)
	if rec.Header().Get("X-Request-Id") == "" {
		t.Fatal("missing request id")
	}
}

func TestHealthzMounted(t *testing.T) {
	h := NewBaseRouter()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/healthz", nil)
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}
