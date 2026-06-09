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

	"github.com/pmplatform/services/tenant-svc/internal/service"
	"github.com/pmplatform/services/tenant-svc/internal/store"
)

func auditTestPool(t *testing.T) *pgxpool.Pool {
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

// TestCreateTenant_EmitsAudit verifies that a real tenant create through the
// HTTP handler lands an audit_log row scoped to the new tenant with the
// caller's user id.
func TestCreateTenant_EmitsAudit(t *testing.T) {
	p := auditTestPool(t)
	uid := uuid.New()

	svc := service.New(store.New(p)).
		WithCustomFields(store.NewCustomFieldStore(p)).
		WithAudit(audit.NewPgPublisher(p, "tenant-svc"))

	h := NewRouter(svc, nil) // nil authz -> RequireAction is a no-op

	slug := "aud-" + uuid.NewString()[:8]
	body := []byte(`{"slug":"` + slug + `","name":"Audit Tenant"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/tenants/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req = req.WithContext(libauth.WithClaims(req.Context(),
		&libauth.ParsedClaims{Subject: uid.String()}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create tenant: status %d body %s", rec.Code, rec.Body.String())
	}

	var newTenantID uuid.UUID
	if err := p.QueryRow(context.Background(),
		`SELECT id FROM tenant WHERE slug = $1`, slug).Scan(&newTenantID); err != nil {
		t.Fatalf("lookup created tenant: %v", err)
	}
	t.Cleanup(func() { _, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, newTenantID) })

	var count int
	err := p.QueryRow(context.Background(), `
		SELECT count(*) FROM audit_log
		WHERE tenant_id = $1 AND service = 'tenant-svc'
		  AND action = 'tenant.create' AND user_id = $2`,
		newTenantID, uid).Scan(&count)
	if err != nil {
		t.Fatalf("query audit_log: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 audit row, got %d", count)
	}
}
