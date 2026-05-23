package service_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	notiflib "github.com/pmplatform/libs/go/notification"
	"github.com/pmplatform/services/notification-svc/internal/service"
	"github.com/pmplatform/services/notification-svc/internal/store"
)

// --- fake channel ---

type fakeChannel struct {
	name   string
	sent   []notiflib.Event
	errOn  string // if non-empty, return error when ev.Kind matches
}

func (f *fakeChannel) Name() string { return f.name }

func (f *fakeChannel) Send(_ context.Context, ev notiflib.Event) error {
	if f.errOn != "" && ev.Kind == f.errOn {
		return fmt.Errorf("fake channel %q forced error", f.name)
	}
	f.sent = append(f.sent, ev)
	return nil
}

// --- test helpers ---

func routerTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	// Probe notification_preference table.
	var dummy int
	if probeErr := p.QueryRow(context.Background(),
		"SELECT 1 FROM notification_preference LIMIT 1").Scan(&dummy); probeErr != nil {
		if !errors.Is(probeErr, pgx.ErrNoRows) &&
			!strings.Contains(probeErr.Error(), "no rows") {
			if strings.Contains(probeErr.Error(), `relation "notification_preference" does not exist`) {
				t.Skipf("notification_preference table not migrated: %v", probeErr)
			}
			t.Skipf("unexpected probe error: %v", probeErr)
		}
	}
	t.Cleanup(p.Close)
	return p
}

func routerSeedTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, $2, $3)`,
		tid, fmt.Sprintf("router-test-%s", tid.String()[:8]), "Router Test")
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tid)
	})
	return tid
}

// --- tests ---

// TestRouter_DefaultInApp verifies that when no preference exists, the event
// is delivered only to the "inapp" channel.
func TestRouter_DefaultInApp(t *testing.T) {
	p := routerTestPool(t)
	prefs := store.NewPreference(p)
	tid := routerSeedTenant(t, p)
	uid := uuid.New()

	inapp := &fakeChannel{name: "inapp"}
	email := &fakeChannel{name: "email"}
	router := service.NewRouter(prefs, inapp, email)

	ev := notiflib.Event{
		TenantID: tid.String(),
		UserID:   uid.String(),
		Kind:     "task.assigned",
		Title:    "you have a task",
	}
	if err := router.Route(context.Background(), ev); err != nil {
		t.Fatalf("Route: %v", err)
	}

	if len(inapp.sent) != 1 {
		t.Errorf("expected 1 inapp delivery, got %d", len(inapp.sent))
	}
	if len(email.sent) != 0 {
		t.Errorf("expected 0 email deliveries, got %d", len(email.sent))
	}
}

// TestRouter_ExplicitChannels verifies that an explicit preference selects
// exactly the registered channels.
func TestRouter_ExplicitChannels(t *testing.T) {
	p := routerTestPool(t)
	prefs := store.NewPreference(p)
	tid := routerSeedTenant(t, p)
	uid := uuid.New()

	// Set preference to email + slack (not inapp).
	if err := prefs.Upsert(context.Background(), tid, uid, "wo.released",
		[]string{"email", "slack"}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	inapp := &fakeChannel{name: "inapp"}
	email := &fakeChannel{name: "email"}
	slack := &fakeChannel{name: "slack"}
	router := service.NewRouter(prefs, inapp, email, slack)

	ev := notiflib.Event{
		TenantID: tid.String(),
		UserID:   uid.String(),
		Kind:     "wo.released",
		Title:    "work order released",
	}
	if err := router.Route(context.Background(), ev); err != nil {
		t.Fatalf("Route: %v", err)
	}

	if len(inapp.sent) != 0 {
		t.Errorf("expected 0 inapp, got %d", len(inapp.sent))
	}
	if len(email.sent) != 1 {
		t.Errorf("expected 1 email, got %d", len(email.sent))
	}
	if len(slack.sent) != 1 {
		t.Errorf("expected 1 slack, got %d", len(slack.sent))
	}
}

// TestRouter_ChannelErrorContinues verifies that a failing channel does not
// prevent delivery to subsequent channels.
func TestRouter_ChannelErrorContinues(t *testing.T) {
	p := routerTestPool(t)
	prefs := store.NewPreference(p)
	tid := routerSeedTenant(t, p)
	uid := uuid.New()

	// Preference: inapp + email; inapp will error.
	if err := prefs.Upsert(context.Background(), tid, uid, "task.assigned",
		[]string{"inapp", "email"}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	inapp := &fakeChannel{name: "inapp", errOn: "task.assigned"}
	email := &fakeChannel{name: "email"}
	router := service.NewRouter(prefs, inapp, email)

	ev := notiflib.Event{
		TenantID: tid.String(),
		UserID:   uid.String(),
		Kind:     "task.assigned",
		Title:    "task",
	}
	// Route should not return error — channel errors are swallowed/logged.
	if err := router.Route(context.Background(), ev); err != nil {
		t.Fatalf("Route returned unexpected error: %v", err)
	}

	// inapp errored, so no sent entries.
	if len(inapp.sent) != 0 {
		t.Errorf("inapp should have 0 sent (errored), got %d", len(inapp.sent))
	}
	// email should still receive the event.
	if len(email.sent) != 1 {
		t.Errorf("email should have 1 sent (continued after inapp error), got %d", len(email.sent))
	}
}
