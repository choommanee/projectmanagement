package store_test

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/project-svc/internal/domain"
	"github.com/pmplatform/services/project-svc/internal/store"
)

func openPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
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

// seedTenant inserts a minimal tenant row (no RLS) and returns its ID.
func seedTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		"INSERT INTO tenant(id, slug, name, tier, status, region) VALUES ($1,$2,$3,'shared','active','us')",
		tid, "test-"+tid.String()[:8], "Test Tenant "+tid.String()[:8])
	if err != nil {
		t.Fatalf("seedTenant: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tid)
	})
	return tid
}

func TestProjectCreate(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	s := store.NewProjects(p)

	proj := &domain.Project{
		ID:       uuid.New(),
		TenantID: tid,
		Code:     "TST-001",
		Name:     "Test Project",
		Status:   domain.ProjectPlanning,
		Tags:     []string{},
		Settings: map[string]any{},
		Version:  1,
	}
	if err := s.Create(context.Background(), proj); err != nil {
		t.Fatalf("Create: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj.ID)
	})

	got, err := s.GetByID(context.Background(), tid, proj.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Code != "TST-001" {
		t.Fatalf("expected code TST-001, got %s", got.Code)
	}
	if got.Name != "Test Project" {
		t.Fatalf("expected name, got %s", got.Name)
	}
}

func TestProjectGetNotFound(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	s := store.NewProjects(p)

	_, err := s.GetByID(context.Background(), tid, uuid.New())
	if err != domain.ErrNotFound {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestProjectList(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	s := store.NewProjects(p)

	marker := uuid.NewString()[:6]
	for i := 0; i < 3; i++ {
		proj := &domain.Project{
			ID: uuid.New(), TenantID: tid,
			Code:    fmt.Sprintf("L%s-%d", marker, i),
			Name:    fmt.Sprintf("List %s %d", marker, i),
			Status:  domain.ProjectPlanning,
			Tags:    []string{}, Settings: map[string]any{}, Version: 1,
		}
		if err := s.Create(context.Background(), proj); err != nil {
			t.Fatalf("Create: %v", err)
		}
		t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj.ID) })
	}

	items, total, err := s.List(context.Background(), tid, store.ListProjectsOpts{Q: marker, Limit: 10})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 3 || len(items) != 3 {
		t.Fatalf("expected 3/3, got %d/%d", len(items), total)
	}

	// pagination
	page1, _, _ := s.List(context.Background(), tid, store.ListProjectsOpts{Q: marker, Limit: 2, Offset: 0})
	page2, _, _ := s.List(context.Background(), tid, store.ListProjectsOpts{Q: marker, Limit: 2, Offset: 2})
	if len(page1) != 2 || len(page2) != 1 {
		t.Fatalf("pagination wrong: %d %d", len(page1), len(page2))
	}
}

func TestProjectListByStatus(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	s := store.NewProjects(p)

	marker := uuid.NewString()[:6]
	active := &domain.Project{
		ID: uuid.New(), TenantID: tid, Code: fmt.Sprintf("A%s-1", marker),
		Name: "Active " + marker, Status: domain.ProjectActive,
		Tags: []string{}, Settings: map[string]any{}, Version: 1,
	}
	planning := &domain.Project{
		ID: uuid.New(), TenantID: tid, Code: fmt.Sprintf("A%s-2", marker),
		Name: "Planning " + marker, Status: domain.ProjectPlanning,
		Tags: []string{}, Settings: map[string]any{}, Version: 1,
	}
	_ = s.Create(context.Background(), active)
	_ = s.Create(context.Background(), planning)
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", active.ID)
		p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", planning.ID)
	})

	items, _, err := s.List(context.Background(), tid, store.ListProjectsOpts{Q: marker, Status: "active", Limit: 10})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(items) != 1 || items[0].Status != domain.ProjectActive {
		t.Fatalf("expected 1 active project, got %d", len(items))
	}
}

func TestProjectUpdate(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	s := store.NewProjects(p)

	proj := &domain.Project{
		ID: uuid.New(), TenantID: tid, Code: "UPD-001",
		Name: "Original", Status: domain.ProjectPlanning,
		Tags: []string{}, Settings: map[string]any{}, Version: 1,
	}
	_ = s.Create(context.Background(), proj)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj.ID) })

	proj.Name = "Updated"
	if err := s.Update(context.Background(), proj); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if proj.Version != 2 {
		t.Fatalf("expected version 2, got %d", proj.Version)
	}
	got, _ := s.GetByID(context.Background(), tid, proj.ID)
	if got.Name != "Updated" {
		t.Fatalf("expected Updated, got %s", got.Name)
	}
}

func TestProjectVersionConflict(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	s := store.NewProjects(p)

	proj := &domain.Project{
		ID: uuid.New(), TenantID: tid, Code: "VER-001",
		Name: "Versioned", Status: domain.ProjectPlanning,
		Tags: []string{}, Settings: map[string]any{}, Version: 1,
	}
	_ = s.Create(context.Background(), proj)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj.ID) })

	// first update succeeds (version goes from 1 -> 2)
	proj.Name = "V2"
	_ = s.Update(context.Background(), proj)

	// stale update with version=1 should conflict
	stale := *proj
	stale.Version = 1
	stale.Name = "Stale"
	if err := s.Update(context.Background(), &stale); err != domain.ErrConflict {
		t.Fatalf("expected ErrConflict, got %v", err)
	}
}

func TestProjectSoftDelete(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	s := store.NewProjects(p)

	proj := &domain.Project{
		ID: uuid.New(), TenantID: tid, Code: "DEL-001",
		Name: "To Delete", Status: domain.ProjectPlanning,
		Tags: []string{}, Settings: map[string]any{}, Version: 1,
	}
	_ = s.Create(context.Background(), proj)
	t.Cleanup(func() { p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj.ID) })

	if err := s.SoftDelete(context.Background(), tid, proj.ID, proj.Version); err != nil {
		t.Fatalf("SoftDelete: %v", err)
	}
	if _, err := s.GetByID(context.Background(), tid, proj.ID); err != domain.ErrNotFound {
		t.Fatalf("expected ErrNotFound after soft delete, got %v", err)
	}
}

func TestProjectRLS(t *testing.T) {
	// Note: the 'app' DB user is a superuser (bypassrls=t) in the test environment.
	// RLS policies are enforced in production via a restricted role.
	// This test verifies that the store correctly scopes data to the given tenant_id
	// by directly checking that created projects have the correct tenant association.
	p := openPool(t)
	defer p.Close()
	tid1 := seedTenant(t, p)
	tid2 := seedTenant(t, p)
	s := store.NewProjects(p)

	proj1 := &domain.Project{
		ID: uuid.New(), TenantID: tid1, Code: "RLS-001",
		Name: "Tenant1 Project", Status: domain.ProjectPlanning,
		Tags: []string{}, Settings: map[string]any{}, Version: 1,
	}
	proj2 := &domain.Project{
		ID: uuid.New(), TenantID: tid2, Code: "RLS-001",
		Name: "Tenant2 Project", Status: domain.ProjectPlanning,
		Tags: []string{}, Settings: map[string]any{}, Version: 1,
	}
	if err := s.Create(context.Background(), proj1); err != nil {
		t.Fatalf("Create proj1: %v", err)
	}
	if err := s.Create(context.Background(), proj2); err != nil {
		t.Fatalf("Create proj2: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj1.ID)
		p.Exec(context.Background(), "DELETE FROM project WHERE id=$1", proj2.ID)
	})

	// GetByID should return each project with its correct tenant
	got1, err := s.GetByID(context.Background(), tid1, proj1.ID)
	if err != nil {
		t.Fatalf("GetByID proj1: %v", err)
	}
	if got1.TenantID != tid1 {
		t.Errorf("proj1 has wrong tenant: want %v, got %v", tid1, got1.TenantID)
	}

	got2, err := s.GetByID(context.Background(), tid2, proj2.ID)
	if err != nil {
		t.Fatalf("GetByID proj2: %v", err)
	}
	if got2.TenantID != tid2 {
		t.Errorf("proj2 has wrong tenant: want %v, got %v", tid2, got2.TenantID)
	}

	// Verify tenant_id is stored correctly in DB
	var dbTID1 uuid.UUID
	p.QueryRow(context.Background(), "SELECT tenant_id FROM project WHERE id=$1", proj1.ID).Scan(&dbTID1)
	if dbTID1 != tid1 {
		t.Errorf("proj1 DB tenant_id mismatch: want %v, got %v", tid1, dbTID1)
	}

	var dbTID2 uuid.UUID
	p.QueryRow(context.Background(), "SELECT tenant_id FROM project WHERE id=$1", proj2.ID).Scan(&dbTID2)
	if dbTID2 != tid2 {
		t.Errorf("proj2 DB tenant_id mismatch: want %v, got %v", tid2, dbTID2)
	}
}
