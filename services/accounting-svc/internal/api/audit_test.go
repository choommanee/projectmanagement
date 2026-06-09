package api_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/pmplatform/libs/go/audit"
	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/accounting-svc/internal/api"
	"github.com/pmplatform/services/accounting-svc/internal/service"
	"github.com/pmplatform/services/accounting-svc/internal/store"
)

// TestCreateAccount_EmitsAudit verifies that a real write through the HTTP
// handler lands an audit_log row with the correct service/action/actor.
func TestCreateAccount_EmitsAudit(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	uid := uuid.New()

	svc := service.New(
		store.NewAccountStore(p),
		store.NewJournalEntryStore(p),
		store.NewInvoiceStore(p),
		store.NewBudgetStore(p),
	).WithAudit(audit.NewPgPublisher(p, "accounting-svc"))

	router := api.NewRouter(svc, nil) // nil authz -> RequireAction no-op

	claims := &libauth.ParsedClaims{
		Subject:  uid.String(),
		TenantID: tid.String(),
		Roles:    []string{"tenant-admin"},
		ExpireAt: time.Now().Add(5 * time.Minute),
	}

	body := []byte(`{"code":"AUD-` + tid.String()[:6] + `","name":"Audit Acct","account_type":"asset"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/accounts", bytes.NewReader(body))
	req.Header.Set("X-Tenant-Id", tid.String())
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(libauth.WithClaims(req.Context(), claims))

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create account: status %d body %s", rec.Code, rec.Body.String())
	}

	var count int
	err := p.QueryRow(context.Background(), `
		SELECT count(*) FROM audit_log
		WHERE tenant_id = $1 AND service = 'accounting-svc'
		  AND action = 'accounting.account.create' AND user_id = $2`,
		tid, uid).Scan(&count)
	if err != nil {
		t.Fatalf("query audit_log: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 audit row, got %d", count)
	}
}
