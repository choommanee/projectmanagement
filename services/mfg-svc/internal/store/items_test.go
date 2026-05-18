package store_test

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
	"github.com/pmplatform/services/mfg-svc/internal/store"
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

// seedTenant creates a test tenant and returns its ID. Cleanup cascades on delete.
func seedTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, $2, $3)`,
		tid, "test-mfg-"+tid.String()[:8], "Test MFG "+tid.String()[:8])
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tid)
	})
	return tid
}

func seedUOM(t *testing.T, s *store.Items, tid uuid.UUID) *domain.UOM {
	t.Helper()
	u := &domain.UOM{
		ID:          uuid.New(),
		TenantID:    tid,
		Code:        "EA-" + tid.String()[:4],
		Name:        "Each",
		RatioToBase: 1,
	}
	if err := s.CreateUOM(context.Background(), u); err != nil {
		t.Fatalf("seed uom: %v", err)
	}
	return u
}

func TestItems_CreateAndGet(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	s := store.NewItems(p)
	u := seedUOM(t, s, tid)

	it := &domain.Item{
		ID:       uuid.New(),
		TenantID: tid,
		Code:     "ITEM-001",
		Name:     "Test Item",
		Type:     domain.ItemTypeFinished,
		Status:   domain.ItemStatusActive,
		UomID:    u.ID,
		Attrs:    map[string]any{},
		Version:  1,
	}
	if err := s.Create(context.Background(), it); err != nil {
		t.Fatalf("create: %v", err)
	}
	got, err := s.GetByID(context.Background(), tid, it.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Code != "ITEM-001" {
		t.Errorf("code = %q, want ITEM-001", got.Code)
	}
}

func TestItems_List(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	s := store.NewItems(p)
	u := seedUOM(t, s, tid)

	for i, code := range []string{"LIST-A", "LIST-B", "LIST-C"} {
		it := &domain.Item{
			ID:       uuid.New(),
			TenantID: tid,
			Code:     code,
			Name:     "Item " + code,
			Type:     domain.ItemTypeComponent,
			Status:   domain.ItemStatusActive,
			UomID:    u.ID,
			Attrs:    map[string]any{},
			Version:  1,
		}
		_ = i
		if err := s.Create(context.Background(), it); err != nil {
			t.Fatalf("create %s: %v", code, err)
		}
	}
	items, total, err := s.List(context.Background(), tid, store.ListItemsOpts{Limit: 100})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if total < 3 {
		t.Errorf("total = %d, want >= 3", total)
	}
	_ = items
}

func TestItems_UpdateVersionConflict(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	s := store.NewItems(p)
	u := seedUOM(t, s, tid)

	it := &domain.Item{
		ID:      uuid.New(),
		TenantID: tid,
		Code:    "VER-001",
		Name:    "Version Test",
		Type:    domain.ItemTypeRaw,
		Status:  domain.ItemStatusActive,
		UomID:   u.ID,
		Attrs:   map[string]any{},
		Version: 1,
	}
	if err := s.Create(context.Background(), it); err != nil {
		t.Fatalf("create: %v", err)
	}
	// Successful update: version=1 → 2
	it.Name = "Updated"
	if err := s.Update(context.Background(), it); err != nil {
		t.Fatalf("update: %v", err)
	}
	// Stale update: version=1 again → conflict
	it.Version = 1
	it.Name = "Stale"
	if err := s.Update(context.Background(), it); err != domain.ErrConflict {
		t.Errorf("expected ErrConflict, got %v", err)
	}
}

func TestItems_SoftDelete(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	s := store.NewItems(p)
	u := seedUOM(t, s, tid)

	it := &domain.Item{
		ID:      uuid.New(),
		TenantID: tid,
		Code:    "DEL-001",
		Name:    "Delete Me",
		Type:    domain.ItemTypeComponent,
		Status:  domain.ItemStatusActive,
		UomID:   u.ID,
		Attrs:   map[string]any{},
		Version: 1,
	}
	if err := s.Create(context.Background(), it); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := s.SoftDelete(context.Background(), tid, it.ID, 1); err != nil {
		t.Fatalf("soft delete: %v", err)
	}
	_, err := s.GetByID(context.Background(), tid, it.ID)
	if err != domain.ErrNotFound {
		t.Errorf("expected ErrNotFound after soft delete, got %v", err)
	}
}
