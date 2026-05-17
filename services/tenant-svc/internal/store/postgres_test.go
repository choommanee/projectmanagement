package store

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pmplatform/services/tenant-svc/internal/domain"
)

func openPool(t *testing.T) *pgxpool.Pool {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5433/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	return p
}

func TestCreateAndGet(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	s := New(p)
	tn, err := domain.NewTenant("acme-"+uuid.NewString()[:8], "Acme Co", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Create(context.Background(), tn); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetByID(context.Background(), tn.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Slug != tn.Slug {
		t.Fatalf("got %s", got.Slug)
	}
	// cleanup
	_, _ = p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tn.ID)
}

func TestUpdateOptimistic(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	s := New(p)
	tn, _ := domain.NewTenant("upd-"+uuid.NewString()[:8], "U", "", "")
	_ = s.Create(context.Background(), tn)
	defer p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tn.ID)
	tn.Name = "U2"
	if err := s.Update(context.Background(), tn); err != nil {
		t.Fatal(err)
	}
	stale := *tn
	stale.Version = 1
	if err := s.Update(context.Background(), &stale); err != domain.ErrConflict {
		t.Fatalf("expected conflict, got %v", err)
	}
}

func TestGetBySlug(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	s := New(p)
	tn, _ := domain.NewTenant("bs-"+uuid.NewString()[:8], "BS", "", "")
	_ = s.Create(context.Background(), tn)
	defer p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tn.ID)
	got, err := s.GetBySlug(context.Background(), tn.Slug)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != tn.ID {
		t.Fatal("mismatch")
	}
}

func TestListSearchAndPagination(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	s := New(p)
	// Seed 3 tenants with a unique marker so we can filter them out
	marker := uuid.NewString()[:8]
	for i := 0; i < 3; i++ {
		tn, _ := domain.NewTenant(fmt.Sprintf("lst-%s-%d", marker, i), fmt.Sprintf("Co %s %d", marker, i), "", "")
		_ = s.Create(context.Background(), tn)
		defer p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tn.ID)
	}
	got, total, err := s.List(context.Background(), "lst-"+marker, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || total != 3 {
		t.Fatalf("got %d/%d", len(got), total)
	}
	// Pagination
	p1, _, _ := s.List(context.Background(), "lst-"+marker, 2, 0)
	p2, _, _ := s.List(context.Background(), "lst-"+marker, 2, 2)
	if len(p1) != 2 || len(p2) != 1 {
		t.Fatalf("paging wrong: %d %d", len(p1), len(p2))
	}
}

func TestSoftDelete(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	s := New(p)
	tn, _ := domain.NewTenant("del-"+uuid.NewString()[:8], "ToDelete", "", "")
	_ = s.Create(context.Background(), tn)
	defer p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tn.ID)
	if err := s.SoftDelete(context.Background(), tn.ID, tn.Version); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetByID(context.Background(), tn.ID); err != domain.ErrNotFound {
		t.Fatalf("expected ErrNotFound after soft delete, got %v", err)
	}
}
