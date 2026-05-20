package store_test

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/quality-svc/internal/domain"
	"github.com/pmplatform/services/quality-svc/internal/store"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(p.Close)
	return p
}

func seedTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, $2, $3)`,
		tid, "q-test-"+tid.String()[:8], "Q Test "+tid.String()[:8])
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tid)
	})
	return tid
}

func seedUOM(t *testing.T, p *pgxpool.Pool, tid uuid.UUID) uuid.UUID {
	t.Helper()
	uid := uuid.New()
	_, err := p.Exec(context.Background(), `
		SET LOCAL app.current_tenant = '`+tid.String()+`';
		INSERT INTO uom(id, tenant_id, code, name, ratio_to_base) VALUES ($1,$2,$3,$4,$5)`,
		uid, tid, "EA"+uid.String()[:4], "Each", 1.0)
	if err != nil {
		// Try without SET LOCAL (superuser context during test setup)
		_, err = p.Exec(context.Background(),
			`INSERT INTO uom(id, tenant_id, code, name, ratio_to_base) VALUES ($1,$2,$3,$4,$5)`,
			uid, tid, "EA"+uid.String()[:4], "Each", 1.0)
		if err != nil {
			t.Fatalf("seed uom: %v", err)
		}
	}
	return uid
}

func seedItem(t *testing.T, p *pgxpool.Pool, tid, uomID uuid.UUID) uuid.UUID {
	t.Helper()
	iid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO item(id, tenant_id, code, name, type, status, uom_id) VALUES ($1,$2,$3,$4,'finished','active',$5)`,
		iid, tid, "Q-ITEM-"+iid.String()[:4], "Q Item", uomID)
	if err != nil {
		t.Fatalf("seed item: %v", err)
	}
	return iid
}

func TestAPQP_CreateAndGet(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	uomID := seedUOM(t, p, tid)
	itemID := seedItem(t, p, tid, uomID)

	s := store.NewAPQP(p)
	a := &domain.APQPProject{
		TenantID: tid,
		ItemID:   &itemID,
		Name:     "Test APQP",
		Phase:    domain.APQPPhaseDesign,
		Status:   domain.APQPStatusInProgress,
	}
	if err := s.Create(context.Background(), a); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if a.ID == uuid.Nil {
		t.Fatal("ID not set")
	}

	got, err := s.GetByID(context.Background(), tid, a.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Name != "Test APQP" {
		t.Errorf("name mismatch: %s", got.Name)
	}
	if got.Phase != domain.APQPPhaseDesign {
		t.Errorf("phase mismatch: %s", got.Phase)
	}
}

func TestAPQP_ListFilter(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	uomID := seedUOM(t, p, tid)
	itemID := seedItem(t, p, tid, uomID)

	s := store.NewAPQP(p)
	for i := 0; i < 3; i++ {
		phase := domain.APQPPhaseConcept
		if i > 0 {
			phase = domain.APQPPhaseDesign
		}
		a := &domain.APQPProject{TenantID: tid, ItemID: &itemID, Name: "APQP", Phase: phase, Status: domain.APQPStatusNotStarted}
		if err := s.Create(context.Background(), a); err != nil {
			t.Fatalf("Create: %v", err)
		}
	}

	items, total, err := s.List(context.Background(), tid, store.ListAPQPOpts{Phase: "concept", ItemID: &itemID})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total < 1 {
		t.Errorf("expected at least 1 concept phase, got %d", total)
	}
	for _, a := range items {
		if a.Phase != domain.APQPPhaseConcept {
			t.Errorf("expected concept, got %s", a.Phase)
		}
	}
}

func TestAPQP_UpdateVersionConflict(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	uomID := seedUOM(t, p, tid)
	itemID := seedItem(t, p, tid, uomID)

	s := store.NewAPQP(p)
	a := &domain.APQPProject{TenantID: tid, ItemID: &itemID, Name: "APQP v", Phase: domain.APQPPhaseConcept, Status: domain.APQPStatusNotStarted}
	if err := s.Create(context.Background(), a); err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Good update
	_, err := s.Update(context.Background(), tid, a.ID, store.UpdateAPQPInput{
		Name: "Updated", Phase: domain.APQPPhaseDesign, Status: domain.APQPStatusInProgress, Version: 1,
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}

	// Stale version conflict
	_, err = s.Update(context.Background(), tid, a.ID, store.UpdateAPQPInput{
		Name: "Conflict", Phase: domain.APQPPhaseDesign, Status: domain.APQPStatusInProgress, Version: 1,
	})
	if err == nil {
		t.Fatal("expected conflict error, got nil")
	}
}
