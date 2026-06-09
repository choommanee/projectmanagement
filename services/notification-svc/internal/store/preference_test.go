package store_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/notification-svc/internal/domain"
	"github.com/pmplatform/services/notification-svc/internal/store"
)

// prefTestPool re-uses testPool from notification_test.go but probes the
// notification_preference table instead of notification.
func prefTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	p := testPool(t) // defined in notification_test.go
	// Probe the preference table so we skip gracefully if not yet migrated.
	var dummy int
	probeErr := p.QueryRow(context.Background(),
		"SELECT 1 FROM notification_preference LIMIT 1").Scan(&dummy)
	if probeErr != nil {
		// Table may simply be empty — only skip if connection itself fails.
		if errors.Is(probeErr, pgx.ErrNoRows) {
			// fine — table exists but is empty
		} else if strings.Contains(probeErr.Error(), `relation "notification_preference" does not exist`) {
			t.Skipf("notification_preference table not migrated: %v", probeErr)
		} else {
			t.Skipf("unexpected probe error: %v", probeErr)
		}
	}
	return p
}

func TestPreference_DefaultInApp(t *testing.T) {
	p := prefTestPool(t)
	ps := store.NewPreference(p)
	tid := seedTenant(t, p)
	uid := uuid.New()

	channels, err := ps.Get(context.Background(), tid, uid, "task.assigned")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if len(channels) != 1 || channels[0] != "inapp" {
		t.Fatalf("expected [inapp], got %v", channels)
	}
}

func TestPreference_UpsertAndGet(t *testing.T) {
	p := prefTestPool(t)
	ps := store.NewPreference(p)
	tid := seedTenant(t, p)
	uid := uuid.New()

	// Upsert with email + inapp.
	if err := ps.Upsert(context.Background(), tid, uid, "task.assigned", []string{"inapp", "email"}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	channels, err := ps.Get(context.Background(), tid, uid, "task.assigned")
	if err != nil {
		t.Fatalf("Get after Upsert: %v", err)
	}
	if len(channels) != 2 {
		t.Fatalf("expected 2 channels, got %v", channels)
	}
	chanSet := make(map[string]bool, len(channels))
	for _, c := range channels {
		chanSet[c] = true
	}
	if !chanSet["inapp"] || !chanSet["email"] {
		t.Fatalf("expected inapp+email, got %v", channels)
	}

	// Update to only slack.
	if err := ps.Upsert(context.Background(), tid, uid, "task.assigned", []string{"slack"}); err != nil {
		t.Fatalf("re-Upsert: %v", err)
	}
	channels, err = ps.Get(context.Background(), tid, uid, "task.assigned")
	if err != nil {
		t.Fatalf("Get after re-Upsert: %v", err)
	}
	if len(channels) != 1 || channels[0] != "slack" {
		t.Fatalf("expected [slack], got %v", channels)
	}
}

func TestPreference_ListAndUpsertMany(t *testing.T) {
	p := prefTestPool(t)
	ps := store.NewPreference(p)
	tid := seedTenant(t, p)
	uid := uuid.New()

	// Empty initially.
	list, err := ps.List(context.Background(), tid, uid)
	if err != nil {
		t.Fatalf("List empty: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("expected 0 rows, got %d", len(list))
	}

	// Bulk upsert two kinds.
	in := []domain.Preference{
		{Kind: "task.assigned", Channels: []string{"inapp", "email"}},
		{Kind: "task.blocked", Channels: []string{"inapp"}},
	}
	if err := ps.UpsertMany(context.Background(), tid, uid, in); err != nil {
		t.Fatalf("UpsertMany: %v", err)
	}
	list, err = ps.List(context.Background(), tid, uid)
	if err != nil {
		t.Fatalf("List after upsert: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(list))
	}

	// Re-upsert one kind with new channels → updates, not duplicates.
	if err := ps.UpsertMany(context.Background(), tid, uid, []domain.Preference{
		{Kind: "task.assigned", Channels: []string{"email"}},
	}); err != nil {
		t.Fatalf("UpsertMany update: %v", err)
	}
	list, _ = ps.List(context.Background(), tid, uid)
	if len(list) != 2 {
		t.Fatalf("expected still 2 rows, got %d", len(list))
	}
	for _, pr := range list {
		if pr.Kind == "task.assigned" && (len(pr.Channels) != 1 || pr.Channels[0] != "email") {
			t.Fatalf("task.assigned channels = %v, want [email]", pr.Channels)
		}
	}
}

func TestPreference_RLS_Isolation(t *testing.T) {
	p := prefTestPool(t)
	ps := store.NewPreference(p)
	tidA := seedTenant(t, p)
	tidB := seedTenant(t, p)
	uid := uuid.New()

	// Set a preference for tenant A.
	if err := ps.Upsert(context.Background(), tidA, uid, "task.assigned", []string{"email"}); err != nil {
		t.Fatalf("Upsert tenant A: %v", err)
	}

	// Tenant B should see default (no row), not tenant A's email preference.
	channels, err := ps.Get(context.Background(), tidB, uid, "task.assigned")
	if err != nil {
		t.Fatalf("Get tenant B: %v", err)
	}
	if len(channels) != 1 || channels[0] != "inapp" {
		t.Fatalf("RLS leak: tenant B sees %v (expected default [inapp])", channels)
	}
}
