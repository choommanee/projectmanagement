package store_test

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/workflow-svc/internal/domain"
	"github.com/pmplatform/services/workflow-svc/internal/store"
)

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
		tid, "wf-test-"+tid.String()[:8], "WF Test Tenant "+tid.String()[:8])
	if err != nil {
		t.Fatalf("seedTenant: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tid) //nolint:errcheck
	})
	return tid
}

func TestDefinitionCreate(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	s := store.NewDefinitions(p)

	d := &domain.WorkflowDefinition{
		ID:             uuid.New(),
		TenantID:       tid,
		Name:           "Test Workflow",
		Description:    "desc",
		Status:         domain.WorkflowDraft,
		CurrentVersion: 1,
		Version:        1,
	}
	if err := s.Create(context.Background(), d); err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := s.GetByID(context.Background(), tid, d.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Name != "Test Workflow" {
		t.Errorf("name mismatch: %s", got.Name)
	}
}

func TestDefinitionList(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	s := store.NewDefinitions(p)

	for i := 0; i < 3; i++ {
		d := &domain.WorkflowDefinition{
			ID:             uuid.New(),
			TenantID:       tid,
			Name:           "Workflow " + uuid.New().String()[:4],
			Status:         domain.WorkflowDraft,
			CurrentVersion: 1,
			Version:        1,
		}
		if err := s.Create(context.Background(), d); err != nil {
			t.Fatalf("create: %v", err)
		}
	}

	items, total, err := s.List(context.Background(), tid, store.ListDefsOpts{Limit: 50})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if total < 3 {
		t.Errorf("expected at least 3, got %d", total)
	}
	_ = items
}

func TestDefinitionUpdate(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	s := store.NewDefinitions(p)

	d := &domain.WorkflowDefinition{
		ID:             uuid.New(),
		TenantID:       tid,
		Name:           "Before Update",
		Status:         domain.WorkflowDraft,
		CurrentVersion: 1,
		Version:        1,
	}
	if err := s.Create(context.Background(), d); err != nil {
		t.Fatalf("create: %v", err)
	}

	d.Name = "After Update"
	if err := s.Update(context.Background(), d); err != nil {
		t.Fatalf("update: %v", err)
	}

	got, _ := s.GetByID(context.Background(), tid, d.ID)
	if got.Name != "After Update" {
		t.Errorf("expected 'After Update', got '%s'", got.Name)
	}
	if got.Version != 2 {
		t.Errorf("expected version=2, got %d", got.Version)
	}
}

func TestDefinitionVersionConflict(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	s := store.NewDefinitions(p)

	d := &domain.WorkflowDefinition{
		ID:             uuid.New(),
		TenantID:       tid,
		Name:           "Conflict Test",
		Status:         domain.WorkflowDraft,
		CurrentVersion: 1,
		Version:        1,
	}
	if err := s.Create(context.Background(), d); err != nil {
		t.Fatalf("create: %v", err)
	}

	// First update — succeeds, version becomes 2
	d.Name = "First"
	if err := s.Update(context.Background(), d); err != nil {
		t.Fatalf("first update: %v", err)
	}

	// Second update with stale version=1 — should conflict
	d2 := *d
	d2.Version = 1
	d2.Name = "Second Stale"
	if err := s.Update(context.Background(), &d2); err == nil {
		t.Error("expected conflict error, got nil")
	}
}
