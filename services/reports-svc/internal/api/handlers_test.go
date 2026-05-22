package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pmplatform/services/reports-svc/internal/api"
	"github.com/pmplatform/services/reports-svc/internal/service"
	"github.com/pmplatform/services/reports-svc/internal/store"
)

// We use a nil pool for handler tests (no DB calls on health check / missing tenant header paths).
// authz is nil here, which makes RequireAction a no-op (libs/go/auth contract); the dedicated
// cedar_create_test.go covers the Cedar allow/deny grid against the shared bundle.
func newTestRouter() http.Handler {
	return api.NewRouter(service.New(store.NewDashboards(nil), store.NewMetrics(nil)), nil)
}

func TestHealthz(t *testing.T) {
	router := newTestRouter()
	req := httptest.NewRequest("GET", "/healthz", nil)
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d, want 200", rr.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("status field: got %q, want 'ok'", body["status"])
	}
}

func TestMissingTenantHeader(t *testing.T) {
	router := newTestRouter()

	endpoints := []struct {
		method string
		path   string
	}{
		{"GET", "/v1/dashboards"},
		{"GET", "/v1/metrics/summary"},
		{"GET", "/v1/metrics/timeseries"},
		{"GET", "/v1/metrics/by-status"},
	}

	for _, ep := range endpoints {
		t.Run(ep.method+" "+ep.path, func(t *testing.T) {
			req := httptest.NewRequest(ep.method, ep.path, nil)
			rr := httptest.NewRecorder()
			router.ServeHTTP(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Errorf("%s %s: status got %d, want 400", ep.method, ep.path, rr.Code)
			}
		})
	}
}

func TestListDashboardsMissingHeader(t *testing.T) {
	router := newTestRouter()

	req := httptest.NewRequest("GET", "/v1/dashboards", nil)
	// No X-Tenant-Id header
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d, want 400", rr.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["error"] == "" {
		t.Error("expected error message in response body")
	}
}
