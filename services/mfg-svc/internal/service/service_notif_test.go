package service_test

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	notiflib "github.com/pmplatform/libs/go/notification"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
	"github.com/pmplatform/services/mfg-svc/internal/service"
	"github.com/pmplatform/services/mfg-svc/internal/store"
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
	t.Cleanup(p.Close)
	return p
}

func seedTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, $2, $3)`,
		tid, "svc-notif-"+tid.String()[:8], "SvcNotif "+tid.String()[:8])
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tid)
	})
	return tid
}

// TestReleaseWorkOrder_PublishesNotifEvent seeds the minimal WO fixture and
// asserts that ReleaseWorkOrder emits a "mfg.work_order.released" event.
func TestReleaseWorkOrder_PublishesNotifEvent(t *testing.T) {
	p := openPool(t)
	tid := seedTenant(t, p)
	ctx := context.Background()

	items := store.NewItems(p)
	boms := store.NewBOMs(p)
	wos := store.NewWorkOrders(p, boms)

	// Seed UOM + item (assembly, so it can have a BOM).
	uom := &domain.UOM{
		ID:          uuid.New(),
		TenantID:    tid,
		Code:        "EA-N-" + tid.String()[:4],
		Name:        "Each",
		RatioToBase: 1,
	}
	if err := items.CreateUOM(ctx, uom); err != nil {
		t.Fatalf("seed uom: %v", err)
	}

	item := &domain.Item{
		ID:       uuid.New(),
		TenantID: tid,
		Code:     "FG-N-" + tid.String()[:4],
		Name:     "FG Notif",
		Type:     domain.ItemTypeAssembly,
		Status:   domain.ItemStatusActive,
		UomID:    uom.ID,
		Attrs:    map[string]any{},
		Version:  1,
	}
	if err := items.Create(ctx, item); err != nil {
		t.Fatalf("seed item: %v", err)
	}

	wo := &domain.WorkOrder{
		ID:       uuid.New(),
		TenantID: tid,
		Code:     "WO-N-" + tid.String()[:4],
		ItemID:   item.ID,
		Qty:      1,
		Status:   domain.WOStatusPlanned,
		Priority: domain.WOPriorityMed,
		Version:  1,
	}
	if err := wos.Create(ctx, wo); err != nil {
		t.Fatalf("seed WO: %v", err)
	}

	// Wire service with fake publisher.
	pub := &fakePublisher{}
	svc := service.New(
		items,
		store.NewWorkCenters(p),
		boms,
		store.NewRoutings(p),
		wos,
		store.NewMRP(p),
		store.NewGenealogy(p),
		store.NewInventory(p),
		"",
		"",
	).WithNotifPublisher(pub)

	actorID := uuid.NewString()
	_, err := svc.ReleaseWorkOrder(ctx, tid, wo.ID, 1, actorID)
	if err != nil {
		t.Fatalf("ReleaseWorkOrder: %v", err)
	}

	if len(pub.events) != 1 {
		t.Fatalf("expected 1 notif event, got %d", len(pub.events))
	}
	ev := pub.events[0]
	if ev.Kind != "mfg.work_order.released" {
		t.Errorf("Kind: got %q, want %q", ev.Kind, "mfg.work_order.released")
	}
	if ev.TenantID != tid.String() {
		t.Errorf("TenantID: got %q, want %q", ev.TenantID, tid.String())
	}
	if ev.UserID != actorID {
		t.Errorf("UserID: got %q, want %q", ev.UserID, actorID)
	}
}
