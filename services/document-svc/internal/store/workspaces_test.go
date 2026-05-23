package store_test

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/document-svc/internal/domain"
	"github.com/pmplatform/services/document-svc/internal/store"
)

func pool(t *testing.T) *pgxpool.Pool {
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

// seedTenantAndProject creates a tenant and a project, registers cleanup.
func seedTenantAndProject(t *testing.T, p *pgxpool.Pool) (tid, pid uuid.UUID) {
	t.Helper()
	tid = uuid.New()
	pid = uuid.New()
	ctx := context.Background()

	_, err := p.Exec(ctx,
		"INSERT INTO tenant(id, slug, name, tier, status, region) VALUES ($1,$2,$3,'shared','active','us')",
		tid, "test-"+tid.String()[:8], "Test Tenant",
	)
	if err != nil {
		t.Fatalf("seedTenant: %v", err)
	}

	_, err = p.Exec(ctx,
		"INSERT INTO project(id, tenant_id, code, name, status, version) VALUES ($1,$2,$3,$4,'planning',1)",
		pid, tid, "TP-"+pid.String()[:4], "Test Project",
	)
	if err != nil {
		t.Fatalf("seedProject: %v", err)
	}

	t.Cleanup(func() {
		p.Exec(ctx, "DELETE FROM tenant WHERE id=$1", tid)
	})
	return tid, pid
}

func TestEnsureWorkspaceUpsert(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, pid := seedTenantAndProject(t, p)
	ws := store.NewWorkspaces(p)

	// First call — creates new workspace
	w1, err := ws.EnsureForProject(context.Background(), tid, pid, domain.WSKindBA, "BA Workspace")
	if err != nil {
		t.Fatalf("EnsureForProject first: %v", err)
	}
	if w1.ID == uuid.Nil {
		t.Fatal("expected non-nil ID")
	}
	if w1.Kind != domain.WSKindBA {
		t.Fatalf("expected kind=ba, got %s", w1.Kind)
	}

	// Second call with same (project, kind) — upsert returns existing with updated name
	w2, err := ws.EnsureForProject(context.Background(), tid, pid, domain.WSKindBA, "BA Workspace Renamed")
	if err != nil {
		t.Fatalf("EnsureForProject second: %v", err)
	}
	if w2.ID != w1.ID {
		t.Fatalf("expected same ID on upsert: got %s vs %s", w1.ID, w2.ID)
	}
	if w2.Name != "BA Workspace Renamed" {
		t.Fatalf("expected updated name, got %s", w2.Name)
	}
}

func TestListWorkspacesForProject(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, pid := seedTenantAndProject(t, p)
	ws := store.NewWorkspaces(p)

	ctx := context.Background()
	_, _ = ws.EnsureForProject(ctx, tid, pid, domain.WSKindPM, "PM WS")
	_, _ = ws.EnsureForProject(ctx, tid, pid, domain.WSKindSA, "SA WS")

	items, err := ws.ListForProject(ctx, tid, pid)
	if err != nil {
		t.Fatalf("ListForProject: %v", err)
	}
	if len(items) < 2 {
		t.Fatalf("expected at least 2 workspaces, got %d", len(items))
	}
}
