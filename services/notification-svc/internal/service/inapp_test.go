package service_test

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	notiflib "github.com/pmplatform/libs/go/notification"
	"github.com/pmplatform/services/notification-svc/internal/service"
	"github.com/pmplatform/services/notification-svc/internal/store"
)

func inappTestPool(t *testing.T) *pgxpool.Pool {
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

func inappSeedTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, $2, $3)`,
		tid, fmt.Sprintf("inapp-test-%s", tid.String()[:8]), "InApp Test")
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tid)
	})
	return tid
}

func TestInAppChannel_Name(t *testing.T) {
	ch := service.NewInAppChannel(nil)
	if ch.Name() != "inapp" {
		t.Errorf("expected channel name 'inapp', got %q", ch.Name())
	}
}

func TestInAppChannel_Send(t *testing.T) {
	p := inappTestPool(t)
	tid := inappSeedTenant(t, p)
	uid := uuid.New()

	st := store.New(p)
	ch := service.NewInAppChannel(st)

	ev := notiflib.Event{
		TenantID: tid.String(),
		UserID:   uid.String(),
		Kind:     "task.assigned",
		Title:    "inapp channel test",
		Body:     "body text",
		Payload:  map[string]any{"ref": "abc"},
	}

	if err := ch.Send(context.Background(), ev); err != nil {
		t.Fatalf("Send: %v", err)
	}

	items, err := st.List(context.Background(), tid, uid, store.ListOpts{})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 notification row, got %d", len(items))
	}
	n := items[0]
	if n.Kind != "task.assigned" {
		t.Errorf("kind: got %q, want %q", n.Kind, "task.assigned")
	}
	if n.Title != "inapp channel test" {
		t.Errorf("title: got %q", n.Title)
	}
	if n.Body != "body text" {
		t.Errorf("body: got %q", n.Body)
	}
	if n.Payload["ref"] != "abc" {
		t.Errorf("payload ref: got %v", n.Payload["ref"])
	}
	if n.ReadAt != nil {
		t.Errorf("expected unread, got read_at %v", n.ReadAt)
	}
}

func TestInAppChannel_Send_BadTenantID(t *testing.T) {
	ch := service.NewInAppChannel(nil)
	ev := notiflib.Event{
		TenantID: "not-a-uuid",
		UserID:   uuid.NewString(),
		Kind:     "test", Title: "t",
	}
	if err := ch.Send(context.Background(), ev); err == nil {
		t.Fatal("expected error for invalid tenant UUID")
	}
}

func TestInAppChannel_Send_BadUserID(t *testing.T) {
	ch := service.NewInAppChannel(nil)
	ev := notiflib.Event{
		TenantID: uuid.NewString(),
		UserID:   "not-a-uuid",
		Kind:     "test", Title: "t",
	}
	if err := ch.Send(context.Background(), ev); err == nil {
		t.Fatal("expected error for invalid user UUID")
	}
}
