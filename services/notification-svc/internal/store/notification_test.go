package store_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/notification-svc/internal/store"
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
	// Probe to confirm reachable + table exists.
	var dummy int
	if err := p.QueryRow(context.Background(), "SELECT 1 FROM notification LIMIT 1").Scan(&dummy); err != nil {
		// Table may simply be empty — only skip if connection itself fails.
		if err.Error() == "no rows in result set" || errors.Is(err, pgx.ErrNoRows) {
			// fine
		} else if err.Error() != "" && contains(err.Error(), `relation "notification" does not exist`) {
			t.Skipf("notification table not migrated: %v", err)
		}
	}
	t.Cleanup(p.Close)
	return p
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func seedTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, $2, $3)`,
		tid, fmt.Sprintf("notif-test-%s", tid.String()[:8]), "Notif Test")
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tid)
	})
	return tid
}

func TestInsertAndList(t *testing.T) {
	p := testPool(t)
	s := store.New(p)
	tid := seedTenant(t, p)
	uid := uuid.New()

	for i := 0; i < 3; i++ {
		_, err := s.Insert(context.Background(), store.InsertParams{
			TenantID: tid, UserID: uid,
			Kind: "task.assigned", Title: fmt.Sprintf("task %d", i),
			Body:    "you have a new task",
			Payload: map[string]any{"i": i},
		})
		if err != nil {
			t.Fatalf("insert: %v", err)
		}
	}

	items, err := s.List(context.Background(), tid, uid, store.ListOpts{Limit: 50})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("expected 3 items, got %d", len(items))
	}
	for _, n := range items {
		if n.ReadAt != nil {
			t.Errorf("expected unread, got read_at=%v", n.ReadAt)
		}
		if n.Kind != "task.assigned" {
			t.Errorf("kind mismatch: %s", n.Kind)
		}
	}
}

func TestUnreadFilter(t *testing.T) {
	p := testPool(t)
	s := store.New(p)
	tid := seedTenant(t, p)
	uid := uuid.New()

	id1, _ := s.Insert(context.Background(), store.InsertParams{
		TenantID: tid, UserID: uid, Kind: "k", Title: "a",
	})
	_, _ = s.Insert(context.Background(), store.InsertParams{
		TenantID: tid, UserID: uid, Kind: "k", Title: "b",
	})
	if err := s.MarkRead(context.Background(), tid, uid, id1); err != nil {
		t.Fatalf("mark read: %v", err)
	}

	unread, err := s.List(context.Background(), tid, uid, store.ListOpts{UnreadOnly: true})
	if err != nil {
		t.Fatalf("list unread: %v", err)
	}
	if len(unread) != 1 {
		t.Fatalf("expected 1 unread, got %d", len(unread))
	}
	if unread[0].Title != "b" {
		t.Errorf("expected title 'b', got %q", unread[0].Title)
	}
}

func TestMarkRead_NotFound(t *testing.T) {
	p := testPool(t)
	s := store.New(p)
	tid := seedTenant(t, p)
	uid := uuid.New()

	err := s.MarkRead(context.Background(), tid, uid, uuid.NewString())
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("expected pgx.ErrNoRows, got %v", err)
	}
}

func TestMarkAllRead(t *testing.T) {
	p := testPool(t)
	s := store.New(p)
	tid := seedTenant(t, p)
	uid := uuid.New()

	for i := 0; i < 4; i++ {
		_, _ = s.Insert(context.Background(), store.InsertParams{
			TenantID: tid, UserID: uid, Kind: "k", Title: fmt.Sprintf("n%d", i),
		})
	}
	n, err := s.MarkAllRead(context.Background(), tid, uid)
	if err != nil {
		t.Fatalf("mark all: %v", err)
	}
	if n != 4 {
		t.Fatalf("expected 4 rows updated, got %d", n)
	}
	unread, _ := s.List(context.Background(), tid, uid, store.ListOpts{UnreadOnly: true})
	if len(unread) != 0 {
		t.Fatalf("expected 0 unread after mark-all, got %d", len(unread))
	}
}

func TestRLS_Isolation(t *testing.T) {
	p := testPool(t)
	s := store.New(p)
	tidA := seedTenant(t, p)
	tidB := seedTenant(t, p)
	uid := uuid.New()

	_, err := s.Insert(context.Background(), store.InsertParams{
		TenantID: tidA, UserID: uid, Kind: "k", Title: "A-only",
	})
	if err != nil {
		t.Fatalf("insert A: %v", err)
	}

	// Tenant B should see nothing for this user.
	items, err := s.List(context.Background(), tidB, uid, store.ListOpts{})
	if err != nil {
		t.Fatalf("list B: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("RLS leak: tenant B sees %d rows", len(items))
	}
}
