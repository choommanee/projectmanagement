package api

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/libs/go/audit"
	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/sales-svc/internal/service"
	"github.com/pmplatform/services/sales-svc/internal/store"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("no test database: %v", err)
	}
	if err := p.Ping(context.Background()); err != nil {
		p.Close()
		t.Skipf("no test database: %v", err)
	}
	t.Cleanup(p.Close)
	return p
}

func seedTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, $2, $3)`,
		tid, "test-sales-audit-"+tid.String()[:8], "Test Sales Audit")
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	t.Cleanup(func() { _, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tid) })
	return tid
}

// TestCreateCustomer_EmitsAudit verifies that a real write through the HTTP
// handler lands an audit_log row with the correct service/action/actor.
func TestCreateCustomer_EmitsAudit(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	uid := uuid.New()

	svc := service.New(
		store.NewCustomerStore(p),
		store.NewSalesOrderStore(p),
		store.NewQuotationStore(p),
		store.NewSalesInvoiceStore(p),
		store.NewShipmentStore(p),
		store.NewOpportunityStore(p),
	).WithAudit(audit.NewPgPublisher(p, "sales-svc"))

	h := NewRouter(svc, nil) // nil authz -> RequireAction is a no-op

	body := []byte(`{"code":"AUD-` + tid.String()[:6] + `","name":"Audit Co"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/customers", bytes.NewReader(body))
	req.Header.Set("X-Tenant-Id", tid.String())
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(libauth.WithClaims(req.Context(),
		&libauth.ParsedClaims{Subject: uid.String(), TenantID: tid.String()}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create customer: status %d body %s", rec.Code, rec.Body.String())
	}

	var count int
	err := p.QueryRow(context.Background(), `
		SELECT count(*) FROM audit_log
		WHERE tenant_id = $1 AND service = 'sales-svc'
		  AND action = 'sales.customer.create' AND user_id = $2`,
		tid, uid).Scan(&count)
	if err != nil {
		t.Fatalf("query audit_log: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 audit row, got %d", count)
	}
}
