package store

import (
	"context"
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
