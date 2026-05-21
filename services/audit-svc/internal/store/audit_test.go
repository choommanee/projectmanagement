package store_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/audit-svc/internal/store"
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

func seedTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, $2, $3)`,
		tid, fmt.Sprintf("store-test-%s", tid.String()[:8]), "Store Test")
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tid)
	})
	return tid
}

func insertEvent(t *testing.T, p *pgxpool.Pool, tid uuid.UUID, svc, action, result string, ts time.Time) string {
	t.Helper()
	ctx := context.Background()
	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	_, _ = tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String()))
	id := uuid.NewString()
	_, err = tx.Exec(ctx, `
		INSERT INTO audit_log(id, tenant_id, ts, service, action, result, meta)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, '{"test": true}'::jsonb)`,
		id, tid.String(), ts, svc, action, result)
	if err != nil {
		t.Fatalf("insert event: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	return id
}

func TestList(t *testing.T) {
	p := testPool(t)
	s := store.New(p)
	tid := seedTenant(t, p)

	now := time.Now().UTC()
	insertEvent(t, p, tid, "identity-svc", "user.login", "success", now)
	insertEvent(t, p, tid, "identity-svc", "user.login", "denied", now.Add(-time.Minute))

	events, total, err := s.List(context.Background(), tid, store.ListOpts{Limit: 50})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total < 2 {
		t.Fatalf("expected ≥2 total events, got %d", total)
	}
	if len(events) < 2 {
		t.Fatalf("expected ≥2 events, got %d", len(events))
	}
}

func TestListByService(t *testing.T) {
	p := testPool(t)
	s := store.New(p)
	tid := seedTenant(t, p)

	now := time.Now().UTC()
	insertEvent(t, p, tid, "identity-svc", "user.login", "success", now)
	insertEvent(t, p, tid, "project-svc", "project.create", "success", now.Add(-time.Minute))

	events, total, err := s.List(context.Background(), tid, store.ListOpts{
		Service: "identity-svc",
		Limit:   50,
	})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total < 1 {
		t.Fatalf("expected ≥1 total for identity-svc, got %d", total)
	}
	for _, ev := range events {
		if ev.Service != "identity-svc" {
			t.Errorf("expected service identity-svc, got %s", ev.Service)
		}
	}
}

func TestListByEntity(t *testing.T) {
	p := testPool(t)
	s := store.New(p)
	tid := seedTenant(t, p)

	now := time.Now().UTC()
	// Insert with entity_type + entity_id using direct SQL
	ctx := context.Background()
	tx, _ := p.Begin(ctx)
	_, _ = tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String()))
	entityID := uuid.NewString()
	_, _ = tx.Exec(ctx, `
		INSERT INTO audit_log(id, tenant_id, ts, service, action, result, entity_type, entity_id)
		VALUES ($1::uuid, $2::uuid, $3, 'mfg-svc', 'work_order.create', 'success', 'work_order', $4)`,
		uuid.NewString(), tid.String(), now, entityID)
	_ = tx.Commit(ctx)

	events, total, err := s.List(context.Background(), tid, store.ListOpts{
		EntityType: "work_order",
		EntityID:   entityID,
		Limit:      50,
	})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total < 1 {
		t.Fatalf("expected ≥1, got %d", total)
	}
	if events[0].EntityID != entityID {
		t.Errorf("expected entity_id %s, got %s", entityID, events[0].EntityID)
	}
}

func TestListByDateRange(t *testing.T) {
	p := testPool(t)
	s := store.New(p)
	tid := seedTenant(t, p)

	now := time.Now().UTC()
	old := now.Add(-72 * time.Hour)
	insertEvent(t, p, tid, "identity-svc", "user.login", "success", now)
	insertEvent(t, p, tid, "identity-svc", "user.login", "success", old)

	from := now.Add(-1 * time.Hour)
	events, total, err := s.List(context.Background(), tid, store.ListOpts{
		From:  &from,
		Limit: 50,
	})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total < 1 {
		t.Fatalf("expected ≥1 event within last hour, got %d", total)
	}
	for _, ev := range events {
		if ev.Timestamp.Before(from) {
			t.Errorf("event ts %v is before from=%v", ev.Timestamp, from)
		}
	}
}

func TestBuckets(t *testing.T) {
	p := testPool(t)
	s := store.New(p)
	tid := seedTenant(t, p)

	now := time.Now().UTC()
	yesterday := now.Add(-24 * time.Hour)
	insertEvent(t, p, tid, "identity-svc", "user.login", "success", now)
	insertEvent(t, p, tid, "identity-svc", "user.login", "denied", now.Add(-time.Minute))
	insertEvent(t, p, tid, "project-svc", "project.create", "success", yesterday)

	buckets, err := s.Buckets(context.Background(), tid, 14)
	if err != nil {
		t.Fatalf("Buckets: %v", err)
	}
	if len(buckets) < 2 {
		t.Fatalf("expected ≥2 buckets (2 days), got %d", len(buckets))
	}
	// Verify identity-svc today has count ≥ 2
	todayStr := now.Format("2006-01-02")
	for _, b := range buckets {
		if b.Day == todayStr && b.Service == "identity-svc" {
			if b.Count < 2 {
				t.Errorf("expected identity-svc today count ≥2, got %d", b.Count)
			}
			return
		}
	}
	t.Errorf("no identity-svc bucket for today=%s in %+v", todayStr, buckets)
}
