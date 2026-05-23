package store_test

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/notification-svc/internal/store"
)

// prefTestPool re-uses testPool from notification_test.go but probes the
// notification_preference table instead of notification.
func prefTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	p := testPool(t) // defined in notification_test.go
	// Probe the preference table so we skip gracefully if not yet migrated.
	var dummy int
	err := p.QueryRow(context.Background(),
		"SELECT 1 FROM notification_preference LIMIT 1").Scan(&dummy)
	if err != nil && !strings.Contains(err.Error(), "no rows in result set") &&
		err.Error() != "no rows in result set" {
		if strings.Contains(err.Error(), `relation "notification_preference" does not exist`) {
			t.Skipf("notification_preference table not migrated: %v", err)
		}
		// pgx.ErrNoRows means table exists but empty — that is fine.
		if !strings.Contains(err.Error(), "no rows") {
			t.Skipf("unexpected probe error: %v", err)
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
