package worker_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/libs/go/notification"

	"github.com/pmplatform/services/notification-svc/internal/service"
	"github.com/pmplatform/services/notification-svc/internal/store"
	"github.com/pmplatform/services/notification-svc/internal/worker"
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

// makeRouter returns a Router wired with a real InAppChannel backed by the pool.
func makeRouter(p *pgxpool.Pool) *service.Router {
	st := store.New(p)
	prefStore := store.NewPreference(p)
	inapp := service.NewInAppChannel(st)
	return service.NewRouter(prefStore, inapp)
}

func TestHandle_BadJSON(t *testing.T) {
	p := testPool(t)
	router := makeRouter(p)
	if err := worker.Handle(context.Background(), router, []byte("not-json")); err == nil {
		t.Fatal("expected error for bad json")
	}
}

func TestHandle_MissingFields(t *testing.T) {
	p := testPool(t)
	router := makeRouter(p)
	data, _ := json.Marshal(notification.Event{TenantID: uuid.NewString()})
	if err := worker.Handle(context.Background(), router, data); err == nil {
		t.Fatal("expected error for missing fields")
	}
}

func TestHandle_PersistsRow(t *testing.T) {
	p := testPool(t)
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, $2, $3)`,
		tid, fmt.Sprintf("worker-%s", tid.String()[:8]), "Worker Test")
	if err != nil {
		t.Skipf("seed tenant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tid)
	})

	router := makeRouter(p)
	uid := uuid.New()
	ev := notification.Event{
		TenantID: tid.String(), UserID: uid.String(),
		Kind: "task.assigned", Title: "from worker",
		Payload: map[string]any{"x": 1},
	}
	data, _ := json.Marshal(ev)
	if err := worker.Handle(context.Background(), router, data); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	items, err := store.New(p).List(context.Background(), tid, uid, store.ListOpts{})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if items[0].Title != "from worker" {
		t.Errorf("title mismatch: %s", items[0].Title)
	}
}
