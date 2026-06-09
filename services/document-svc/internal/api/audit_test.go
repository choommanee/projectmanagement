package api_test

import (
	"context"
	"testing"

	"github.com/pmplatform/libs/go/audit"

	"github.com/pmplatform/services/document-svc/internal/api"
	"github.com/pmplatform/services/document-svc/internal/service"
	"github.com/pmplatform/services/document-svc/internal/store"
)

// TestCreateTemplateEmitsAuditLog verifies that a successful document-management
// write lands a row in the PLATFORM audit_log (real Postgres). This is separate
// from the signing subsystem's hash-chained sign_event trail.
func TestCreateTemplateEmitsAuditLog(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)

	svc := service.New(
		store.NewWorkspaces(p),
		store.NewDocuments(p),
		store.NewComments(p),
		store.NewTemplates(p),
	).WithAuditPublisher(audit.NewPgPublisher(p, "document-svc"))
	h := api.NewRouter(svc, nil)

	rr := doJSON(t, h, "POST", "/v1/templates",
		map[string]any{"type": "note", "name": "Audit Test Template"},
		map[string]string{"X-Tenant-Id": tid.String()})
	if rr.Code != 201 {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}

	var svcName, entityType string
	var entityID *string
	err := p.QueryRow(context.Background(),
		`SELECT service, entity_type, entity_id FROM audit_log
		 WHERE tenant_id = $1 AND action = 'document.template.create'
		 ORDER BY ts DESC LIMIT 1`, tid).Scan(&svcName, &entityType, &entityID)
	if err != nil {
		t.Fatalf("expected audit_log row for document.template.create: %v", err)
	}
	if svcName != "document-svc" || entityType != "document_template" || entityID == nil || *entityID == "" {
		t.Fatalf("unexpected audit row: service=%q entity_type=%q entity_id=%v", svcName, entityType, entityID)
	}
}
