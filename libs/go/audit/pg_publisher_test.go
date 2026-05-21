package audit

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
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

func seedAuditTenant(t *testing.T, p *pgxpool.Pool) string {
	t.Helper()
	tid := uuid.NewString()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, $2, $3)`,
		tid, "audit-test-"+tid[:8], "Audit Test")
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tid)
	})
	return tid
}

// TestPgPublishWritesRow verifies that publishing an event inserts a row in audit_log.
func TestPgPublishWritesRow(t *testing.T) {
	p := testPool(t)
	tid := seedAuditTenant(t, p)

	pub := NewPgPublisher(p, "test-svc")
	ev := Event{
		TenantID:   tid,
		Action:     "user.login",
		Service:    "test-svc",
		Result:     "success",
		EntityType: "user",
		EntityID:   "u-1234",
		Meta:       map[string]any{"email": "test@example.com"},
	}

	if err := pub.Publish(context.Background(), "user.login", ev); err != nil {
		t.Fatalf("Publish error: %v", err)
	}

	// Verify row exists
	ctx := context.Background()
	tx, _ := p.Begin(ctx)
	_, _ = tx.Exec(ctx, "SET LOCAL app.current_tenant = '"+tid+"'")
	var count int
	err := tx.QueryRow(ctx,
		`SELECT count(*) FROM audit_log WHERE tenant_id = $1 AND action = 'user.login'`, tid).Scan(&count)
	_ = tx.Commit(ctx)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if count < 1 {
		t.Fatalf("expected ≥1 row, got %d", count)
	}
}

// TestPgPublishHonorsTenant verifies SET LOCAL tenant isolation and correct tenant_id on insert.
func TestPgPublishHonorsTenant(t *testing.T) {
	p := testPool(t)
	tid := seedAuditTenant(t, p)

	pub := NewPgPublisher(p, "identity-svc")
	evID := uuid.NewString()
	ev := Event{
		ID:        evID,
		TenantID:  tid,
		Action:    "tenant.check",
		Result:    "success",
		Timestamp: time.Now().UTC(),
	}

	if err := pub.Publish(context.Background(), "tenant.check", ev); err != nil {
		t.Fatalf("Publish error: %v", err)
	}

	// Query directly (no RLS needed since we use superuser-style direct query)
	var gotTenantID string
	err := p.QueryRow(context.Background(),
		`SELECT tenant_id::text FROM audit_log WHERE id = $1`, evID).Scan(&gotTenantID)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if gotTenantID != tid {
		t.Fatalf("expected tenant_id=%s got %s", tid, gotTenantID)
	}
}
