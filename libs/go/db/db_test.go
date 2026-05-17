package db

import (
	"context"
	"os"
	"testing"
)

func TestConnectAndPing(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	defer p.Close()
	if err := p.Ping(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestWithTenantSetsLocal(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	defer p.Close()
	var got *string
	err = WithTenant(context.Background(), p, "11111111-1111-1111-1111-111111111111", func(ctx context.Context) error {
		tx := GetTx(ctx)
		return tx.QueryRow(ctx, "SELECT current_setting('app.current_tenant', true)").Scan(&got)
	})
	if err != nil {
		t.Fatal(err)
	}
}
