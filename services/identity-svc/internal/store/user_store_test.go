package store

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/identity-svc/internal/domain"
)

func pool(t *testing.T) *pgxpool.Pool {
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

func makeTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	id := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, 'u-'||substr(md5(random()::text),1,6), 'X')`, id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func TestCreateAndFindUser(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid := makeTenant(t, p)
	defer p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tid)

	s := NewUsers(p)
	pw, _ := domain.HashPassword("StrongPass1!")
	email := "a-" + uuid.NewString()[:6] + "@test.com"
	u := &domain.User{
		ID: uuid.New(), TenantID: tid, Email: email,
		DisplayName: "A", Status: domain.StatusActive, PasswordHash: pw, Version: 1,
	}
	if err := s.Create(context.Background(), u); err != nil {
		t.Fatal(err)
	}
	got, err := s.FindByEmail(context.Background(), tid, email)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != u.ID {
		t.Fatalf("got %v want %v", got.ID, u.ID)
	}
	if got.PasswordHash != pw {
		t.Fatal("password hash mismatch")
	}
}

func TestFindMissing(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid := makeTenant(t, p)
	defer p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tid)
	s := NewUsers(p)
	if _, err := s.FindByEmail(context.Background(), tid, "nope@nope.com"); err != domain.ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}
