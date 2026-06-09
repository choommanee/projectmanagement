package api_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/libs/go/audit"
	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/workflow-svc/internal/api"
	"github.com/pmplatform/services/workflow-svc/internal/service"
	"github.com/pmplatform/services/workflow-svc/internal/store"
)

// TestCreateWorkflow_EmitsAudit verifies that a real write through the HTTP
// handler lands an audit_log row with the correct service/action/actor.
func TestCreateWorkflow_EmitsAudit(t *testing.T) {
	p := openPool(t)
	tid := seedTenant(t, p)
	uid := uuid.New()

	svc := service.New(
		store.NewDefinitions(p),
		store.NewVersions(p),
		store.NewInstances(p),
		store.NewHumanTasks(p),
		"http://localhost:0", // runtime not needed for definition create
	).WithAudit(audit.NewPgPublisher(p, "workflow-svc"))

	h := api.NewRouter(svc, nil) // nil authz -> RequireAction is a no-op

	body := []byte(`{"name":"Audit WF ` + tid.String()[:6] + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/workflows", bytes.NewReader(body))
	req.Header.Set("X-Tenant-Id", tid.String())
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(libauth.WithClaims(req.Context(),
		&libauth.ParsedClaims{Subject: uid.String(), TenantID: tid.String()}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create workflow: status %d body %s", rec.Code, rec.Body.String())
	}

	var count int
	err := p.QueryRow(context.Background(), `
		SELECT count(*) FROM audit_log
		WHERE tenant_id = $1 AND service = 'workflow-svc'
		  AND action = 'workflow.create' AND user_id = $2`,
		tid, uid).Scan(&count)
	if err != nil {
		t.Fatalf("query audit_log: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 audit row, got %d", count)
	}
}
