package api_test

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pmplatform/libs/go/audit"

	"github.com/pmplatform/services/quality-svc/internal/api"
)

// TestCreateAPQPEmitsAuditLog verifies that a successful write through the
// HTTP surface lands a row in the platform audit_log (real Postgres).
func TestCreateAPQPEmitsAuditLog(t *testing.T) {
	svc, p := setupSvc(t)
	svc.WithAuditPublisher(audit.NewPgPublisher(p, "quality-svc"))
	tid := seedTestTenant(t, p)
	h := api.NewRouter(svc, nil)

	req := httptest.NewRequest("POST", "/v1/apqp", strings.NewReader(`{"name":"Audit Test APQP"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-Id", tid.String())
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var svcName, entityType string
	var entityID *string
	err := p.QueryRow(context.Background(),
		`SELECT service, entity_type, entity_id FROM audit_log
		 WHERE tenant_id = $1 AND action = 'quality.apqp.create'
		 ORDER BY ts DESC LIMIT 1`, tid).Scan(&svcName, &entityType, &entityID)
	if err != nil {
		t.Fatalf("expected audit_log row for quality.apqp.create: %v", err)
	}
	if svcName != "quality-svc" || entityType != "apqp_project" || entityID == nil || *entityID == "" {
		t.Fatalf("unexpected audit row: service=%q entity_type=%q entity_id=%v", svcName, entityType, entityID)
	}
}
