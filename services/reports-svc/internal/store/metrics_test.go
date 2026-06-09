package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/reports-svc/internal/store"
)

func TestSummaryReturnsZerosForEmptyTenant(t *testing.T) {
	p := testPool(t)
	m := store.NewMetrics(p)
	tid := newTenantID(t, p)

	summary, err := m.Summary(context.Background(), tid)
	if err != nil {
		t.Fatalf("Summary: %v", err)
	}
	if summary.Projects.Total != 0 {
		t.Errorf("Projects.Total: got %d, want 0", summary.Projects.Total)
	}
	if summary.Tasks.Total != 0 {
		t.Errorf("Tasks.Total: got %d, want 0", summary.Tasks.Total)
	}
	if summary.WorkOrders.Total != 0 {
		t.Errorf("WorkOrders.Total: got %d, want 0", summary.WorkOrders.Total)
	}
	if summary.NcrsOpen != 0 {
		t.Errorf("NcrsOpen: got %d, want 0", summary.NcrsOpen)
	}
	if summary.AuditEvents24h < 0 {
		t.Errorf("AuditEvents24h: got %d, want >=0", summary.AuditEvents24h)
	}
}

func TestSummaryCountsAcrossEntities(t *testing.T) {
	p := testPool(t)
	m := store.NewMetrics(p)
	tid := newTenantID(t, p)

	// Seed a project
	projID := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO project(id, tenant_id, code, name, status, version) VALUES ($1,$2,$3,$4,'active',1)`,
		projID, tid, "TST-001", "Test Project",
	)
	if err != nil {
		t.Fatalf("seed project: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), `UPDATE project SET deleted_at=now() WHERE id=$1`, projID)
	})

	// Seed a task
	taskID := uuid.New()
	_, err = p.Exec(context.Background(),
		`INSERT INTO task(id, tenant_id, project_id, code, title, status, type, priority, version) VALUES ($1,$2,$3,$4,$5,'todo','task','med',1)`,
		taskID, tid, projID, "T-001", "Test Task",
	)
	if err != nil {
		t.Fatalf("seed task: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), `UPDATE task SET deleted_at=now() WHERE id=$1`, taskID)
	})

	summary, err := m.Summary(context.Background(), tid)
	if err != nil {
		t.Fatalf("Summary: %v", err)
	}
	if summary.Projects.Total < 1 {
		t.Errorf("Projects.Total: got %d, want >=1", summary.Projects.Total)
	}
	if summary.Projects.Active < 1 {
		t.Errorf("Projects.Active: got %d, want >=1", summary.Projects.Active)
	}
	if summary.Tasks.Total < 1 {
		t.Errorf("Tasks.Total: got %d, want >=1", summary.Tasks.Total)
	}
}

// TestSummaryIsolatesFailingCounts is a regression test for a bug where a
// single count against a not-yet-migrated table (e.g. nonconformance_report)
// aborted the shared transaction, silently zeroing EVERY count that ran after
// it (documents, audit events, workflow runs). safeCount now wraps each query
// in a savepoint, so an audit_log row seeded here must still be counted even
// though earlier counts in the same Summary may fail.
func TestSummaryIsolatesFailingCounts(t *testing.T) {
	p := testPool(t)
	m := store.NewMetrics(p)
	tid := newTenantID(t, p)

	// Seed an audit_log row (audit_events is the LAST count in Summary, after
	// the nonconformance_report count that errors when the table is missing).
	ctx := context.Background()
	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if _, err := tx.Exec(ctx, "SET LOCAL app.current_tenant = '"+tid.String()+"'"); err != nil {
		t.Fatalf("set tenant: %v", err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO audit_log(tenant_id, service, action, result, ts) VALUES ($1,'test','test.action','success', now())`,
		tid,
	); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("seed audit_log: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	summary, err := m.Summary(ctx, tid)
	if err != nil {
		t.Fatalf("Summary: %v", err)
	}
	if summary.AuditEvents24h < 1 {
		t.Fatalf("AuditEvents24h: got %d, want >=1 — a failing count earlier in the tx zeroed it", summary.AuditEvents24h)
	}
}

func TestTimeseriesByDay(t *testing.T) {
	p := testPool(t)
	m := store.NewMetrics(p)
	tid := newTenantID(t, p)

	// Timeseries for audit_events should not error even if table is empty
	points, err := m.Timeseries(context.Background(), tid, "audit_events", 14)
	if err != nil {
		t.Fatalf("Timeseries: %v", err)
	}
	// Should return a slice (possibly empty)
	if points == nil {
		t.Error("expected non-nil slice")
	}

	// Unknown metric should return empty slice
	points2, err := m.Timeseries(context.Background(), tid, "unknown_metric", 14)
	if err != nil {
		t.Fatalf("Timeseries unknown: %v", err)
	}
	if len(points2) != 0 {
		t.Errorf("expected empty for unknown metric, got %d", len(points2))
	}
}
