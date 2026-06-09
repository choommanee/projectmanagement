package api_test

import (
	"context"
	"testing"

	"github.com/pmplatform/libs/go/audit"

	"github.com/pmplatform/services/project-svc/internal/api"
	"github.com/pmplatform/services/project-svc/internal/service"
	"github.com/pmplatform/services/project-svc/internal/store"
)

// TestCreateProjectEmitsAuditLog verifies that a successful write through the
// HTTP surface lands a row in the platform audit_log (real Postgres, no mocks).
func TestCreateProjectEmitsAuditLog(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)

	svc := service.New(store.NewProjects(p), store.NewTasks(p), store.NewSprints(p)).
		WithAuditPublisher(audit.NewPgPublisher(p, "project-svc"))
	svc.Worklog = store.NewWorklogStore(p)
	h := api.NewRouter(svc, nil)

	rr := doJSON(t, h, "POST", "/v1/projects",
		map[string]any{"code": "AUD1", "name": "Audit Test Project"},
		map[string]string{"X-Tenant-Id": tid.String()})
	if rr.Code != 201 {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}

	var (
		svcName, action, entityType string
		entityID                    *string
	)
	err := p.QueryRow(context.Background(),
		`SELECT service, action, entity_type, entity_id FROM audit_log
		 WHERE tenant_id = $1 AND action = 'project.create'
		 ORDER BY ts DESC LIMIT 1`, tid).Scan(&svcName, &action, &entityType, &entityID)
	if err != nil {
		t.Fatalf("expected audit_log row for project.create: %v", err)
	}
	if svcName != "project-svc" || entityType != "project" || entityID == nil || *entityID == "" {
		t.Fatalf("unexpected audit row: service=%q entity_type=%q entity_id=%v", svcName, entityType, entityID)
	}
}
