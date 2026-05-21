package store_test

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/reports-svc/internal/domain"
	"github.com/pmplatform/services/reports-svc/internal/store"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	t.Cleanup(p.Close)
	return p
}

func newTenantID(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, $2, $3)`,
		tid, "test-"+tid.String()[:8], "Test Tenant",
	)
	if err != nil {
		t.Fatalf("insert tenant: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), `DELETE FROM dashboard WHERE tenant_id=$1`, tid)
		p.Exec(context.Background(), `DELETE FROM tenant WHERE id=$1`, tid)
	})
	return tid
}

func TestDashboardCreate(t *testing.T) {
	p := testPool(t)
	s := store.NewDashboards(p)
	tid := newTenantID(t, p)

	d, err := s.Create(context.Background(), store.CreateDashboardInput{
		TenantID:    tid,
		Name:        "Test Dashboard",
		Description: "A test",
		Visibility:  domain.VisPrivate,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if d.ID == uuid.Nil {
		t.Error("expected non-nil ID")
	}
	if d.Name != "Test Dashboard" {
		t.Errorf("name: got %q", d.Name)
	}
	if d.Version != 1 {
		t.Errorf("version: got %d, want 1", d.Version)
	}
}

func TestDashboardList(t *testing.T) {
	p := testPool(t)
	s := store.NewDashboards(p)
	tid := newTenantID(t, p)

	for i := 0; i < 3; i++ {
		_, err := s.Create(context.Background(), store.CreateDashboardInput{
			TenantID:   tid,
			Name:       "Dashboard",
			Visibility: domain.VisPrivate,
		})
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
	}

	items, total, err := s.List(context.Background(), tid, store.ListDashboardsOpts{Limit: 50})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total < 3 {
		t.Errorf("total: got %d, want >=3", total)
	}
	if len(items) < 3 {
		t.Errorf("items: got %d, want >=3", len(items))
	}
}

func TestDashboardUpdate(t *testing.T) {
	p := testPool(t)
	s := store.NewDashboards(p)
	tid := newTenantID(t, p)

	d, err := s.Create(context.Background(), store.CreateDashboardInput{
		TenantID:   tid,
		Name:       "Original Name",
		Visibility: domain.VisPrivate,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	newName := "Updated Name"
	updated, err := s.Update(context.Background(), store.UpdateDashboardInput{
		TenantID: tid,
		ID:       d.ID,
		Name:     &newName,
		Version:  d.Version,
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Name != "Updated Name" {
		t.Errorf("name: got %q", updated.Name)
	}
	if updated.Version != 2 {
		t.Errorf("version: got %d, want 2", updated.Version)
	}
}

func TestDashboardVersionConflict(t *testing.T) {
	p := testPool(t)
	s := store.NewDashboards(p)
	tid := newTenantID(t, p)

	d, err := s.Create(context.Background(), store.CreateDashboardInput{
		TenantID:   tid,
		Name:       "Conflict Test",
		Visibility: domain.VisPrivate,
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	// Use wrong version (0 instead of 1)
	wrongName := "Wrong"
	_, err = s.Update(context.Background(), store.UpdateDashboardInput{
		TenantID: tid,
		ID:       d.ID,
		Name:     &wrongName,
		Version:  0,
	})
	if err == nil {
		t.Fatal("expected conflict error, got nil")
	}
	if !isConflict(err) {
		t.Errorf("expected conflict, got: %v", err)
	}
}

func isConflict(err error) bool {
	return err == domain.ErrConflict
}
