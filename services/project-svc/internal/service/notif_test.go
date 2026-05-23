package service_test

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	notiflib "github.com/pmplatform/libs/go/notification"

	"github.com/pmplatform/services/project-svc/internal/service"
	"github.com/pmplatform/services/project-svc/internal/store"
)

type fakePublisher struct {
	events []notiflib.Event
}

func (f *fakePublisher) Publish(_ context.Context, ev notiflib.Event) error {
	f.events = append(f.events, ev)
	return nil
}

func openPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	return p
}

func seedTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		"INSERT INTO tenant(id, slug, name, tier, status, region) VALUES ($1,$2,$3,'shared','active','us')",
		tid, "notif-"+tid.String()[:8], "Notif Test")
	if err != nil {
		t.Fatalf("seedTenant: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tid)
	})
	return tid
}

// TestCreateProject_PublishesNotifEvent asserts that CreateProject emits
// a "project.created" event to the injected publisher.
func TestCreateProject_PublishesNotifEvent(t *testing.T) {
	p := openPool(t)
	defer p.Close()

	tid := seedTenant(t, p)

	pub := &fakePublisher{}
	svc := service.New(store.NewProjects(p), store.NewTasks(p), store.NewSprints(p)).
		WithNotifPublisher(pub)

	actorID := uuid.NewString()
	proj, err := svc.CreateProject(context.Background(), service.CreateProjectInput{
		TenantID: tid,
		Code:     "NOTIF",
		Name:     "Notif Test Project",
		ActorID:  actorID,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}

	if len(pub.events) != 1 {
		t.Fatalf("expected 1 notif event, got %d", len(pub.events))
	}
	ev := pub.events[0]
	if ev.Kind != "project.created" {
		t.Errorf("Kind: got %q, want %q", ev.Kind, "project.created")
	}
	if ev.TenantID != tid.String() {
		t.Errorf("TenantID: got %q, want %q", ev.TenantID, tid.String())
	}
	if ev.UserID != actorID {
		t.Errorf("UserID: got %q, want %q", ev.UserID, actorID)
	}
	_ = proj
}
