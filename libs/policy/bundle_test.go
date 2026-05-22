package policy

import (
	"os"
	"path/filepath"
	"testing"

	libauth "github.com/pmplatform/libs/go/auth"
)

// loadEngine builds an Adapter from the embedded bundle once per test.
// Helper keeps the table-driven tests below terse.
func loadEngine(t *testing.T) *Adapter {
	t.Helper()
	ps, err := LoadShared()
	if err != nil {
		t.Fatalf("LoadShared: %v", err)
	}
	return &Adapter{Policies: ps}
}

// resourceFor picks a Cedar resource that loosely matches the action's
// service prefix. Per-instance scoping is a Plan #6 ABAC follow-up; today
// all permits use resource `*`, so a Resource::"*" target suffices for the
// permit grid below.
func resourceFor(_ string) string { return `Resource::"*"` }

// TestBundleGrid is the table-driven coverage matrix for the Cedar bundle.
// One row per service per `permit` block (plus the platform-admin actions
// and the destructive-forbid overrides), with at least two deny cases per
// service (wrong role + no role).
func TestBundleGrid(t *testing.T) {
	a := loadEngine(t)

	type row struct {
		name      string
		action    string
		roles     []string
		confirm   bool
		wantAllow bool
	}

	rows := []row{
		// --- platform-admin actions ----------------------------------------
		{"jwt.rotate allow platform-admin", "jwt.rotate", []string{"platform-admin"}, false, true},
		{"jwt.rotate deny tenant-admin", "jwt.rotate", []string{"tenant-admin"}, false, false},
		{"jwt.rotate deny anon", "jwt.rotate", nil, false, false},
		{"policy.reload allow platform-admin", "policy.reload", []string{"platform-admin"}, false, true},
		{"policy.reload deny tenant-admin", "policy.reload", []string{"tenant-admin"}, false, false},
		{"policy.reload deny anon", "policy.reload", nil, false, false},

		// --- tenant-svc ----------------------------------------------------
		{"tenant.create allow platform-admin", "tenant.create", []string{"platform-admin"}, false, true},
		{"tenant.update allow tenant-admin", "tenant.update", []string{"tenant-admin"}, false, true},
		{"tenant.update deny mfg-operator", "tenant.update", []string{"mfg-operator"}, false, false},
		{"tenant.update deny anon", "tenant.update", nil, false, false},

		// --- project-svc ---------------------------------------------------
		{"project.create allow project-manager", "project.create", []string{"project-manager"}, false, true},
		{"project.task.create allow tenant-admin", "project.task.create", []string{"tenant-admin"}, false, true},
		{"project.sprint.assign_task allow project-manager", "project.sprint.assign_task", []string{"project-manager"}, false, true},
		{"project.task.update deny quality-engineer", "project.task.update", []string{"quality-engineer"}, false, false},
		{"project.task.update deny anon", "project.task.update", nil, false, false},
		{"project.read allow anon (public read)", "project.read", nil, false, true},

		// --- document-svc --------------------------------------------------
		{"document.create allow project-manager", "document.create", []string{"project-manager"}, false, true},
		{"document.workspace.ensure allow tenant-admin", "document.workspace.ensure", []string{"tenant-admin"}, false, true},
		{"document.update deny mfg-operator", "document.update", []string{"mfg-operator"}, false, false},
		{"document.delete deny anon", "document.delete", nil, false, false},

		// --- mfg-svc -------------------------------------------------------
		{"mfg.item.create allow mfg-operator", "mfg.item.create", []string{"mfg-operator"}, false, true},
		{"mfg.bom.activate allow tenant-admin", "mfg.bom.activate", []string{"tenant-admin"}, false, true},
		{"mfg.work_order.release allow mfg-operator", "mfg.work_order.release", []string{"mfg-operator"}, false, true},
		{"mfg.lot.create allow mfg-operator", "mfg.lot.create", []string{"mfg-operator"}, false, true},
		{"mfg.mrp.run deny quality-engineer", "mfg.mrp.run", []string{"quality-engineer"}, false, false},
		{"mfg.item.update deny anon", "mfg.item.update", nil, false, false},

		// --- quality-svc ---------------------------------------------------
		{"quality.apqp.create allow quality-engineer", "quality.apqp.create", []string{"quality-engineer"}, false, true},
		{"quality.ppap.update allow tenant-admin", "quality.ppap.update", []string{"tenant-admin"}, false, true},
		{"quality.fmea.add_mode allow quality-engineer", "quality.fmea.add_mode", []string{"quality-engineer"}, false, true},
		{"quality.ncr.create_capa allow quality-engineer", "quality.ncr.create_capa", []string{"quality-engineer"}, false, true},
		{"quality.capa.update deny mfg-operator", "quality.capa.update", []string{"mfg-operator"}, false, false},
		{"quality.inspection.create deny anon", "quality.inspection.create", nil, false, false},

		// --- workflow-svc --------------------------------------------------
		{"workflow.create allow workflow-author", "workflow.create", []string{"workflow-author"}, false, true},
		{"workflow.publish allow tenant-admin", "workflow.publish", []string{"tenant-admin"}, false, true},
		{"workflow.instance.start allow workflow-author", "workflow.instance.start", []string{"workflow-author"}, false, true},
		{"workflow.human_task.complete allow workflow-author", "workflow.human_task.complete", []string{"workflow-author"}, false, true},
		{"workflow.update deny mfg-operator", "workflow.update", []string{"mfg-operator"}, false, false},
		{"workflow.instance.cancel deny anon", "workflow.instance.cancel", nil, false, false},

		// --- reports-svc ---------------------------------------------------
		{"report.dashboard.create allow bi-author", "report.dashboard.create", []string{"bi-author"}, false, true},
		{"report.dashboard.update allow tenant-admin", "report.dashboard.update", []string{"tenant-admin"}, false, true},
		{"report.dashboard.delete deny mfg-operator", "report.dashboard.delete", []string{"mfg-operator"}, false, false},
		{"report.dashboard.create deny anon", "report.dashboard.create", nil, false, false},

		// --- destructive forbid grid ---------------------------------------
		// tenant.delete: even platform-admin needs confirm=true; tenant-admin
		// is rejected because the forbid wins over the permit.
		{"tenant.delete allow platform-admin+confirm", "tenant.delete", []string{"platform-admin"}, true, true},
		{"tenant.delete deny platform-admin no confirm", "tenant.delete", []string{"platform-admin"}, false, false},
		{"tenant.delete deny tenant-admin (forbid wins)", "tenant.delete", []string{"tenant-admin"}, true, false},

		{"project.delete allow platform-admin+confirm", "project.delete", []string{"platform-admin"}, true, true},
		{"project.delete deny project-manager (forbid wins)", "project.delete", []string{"project-manager"}, true, false},
		{"project.delete deny platform-admin no confirm", "project.delete", []string{"platform-admin"}, false, false},

		{"workflow.delete allow platform-admin+confirm", "workflow.delete", []string{"platform-admin"}, true, true},
		{"workflow.delete deny workflow-author (forbid wins)", "workflow.delete", []string{"workflow-author"}, true, false},

		{"mfg.work_order.delete allow platform-admin+confirm", "mfg.work_order.delete", []string{"platform-admin"}, true, true},
		{"mfg.work_order.delete deny mfg-operator (forbid wins)", "mfg.work_order.delete", []string{"mfg-operator"}, true, false},
		{"mfg.work_order.delete deny platform-admin no confirm", "mfg.work_order.delete", []string{"platform-admin"}, false, false},
	}

	for _, r := range rows {
		r := r
		t.Run(r.name, func(t *testing.T) {
			roles := r.roles
			if roles == nil {
				roles = []string{}
			}
			allow, err := a.IsAllowed(libauth.AuthzRequest{
				Principal: `User::"sub-1"`,
				Action:    `Action::"` + r.action + `"`,
				Resource:  resourceFor(r.action),
				Context: map[string]any{
					"roles":               roles,
					"tenant_id":           "t1",
					"confirm_destructive": r.confirm,
				},
			})
			if err != nil {
				t.Fatalf("IsAllowed(%s): %v", r.action, err)
			}
			if allow != r.wantAllow {
				t.Fatalf("action=%s roles=%v confirm=%v: got allow=%v want=%v",
					r.action, roles, r.confirm, allow, r.wantAllow)
			}
		})
	}
}

func TestAdapterNilDenies(t *testing.T) {
	var a *Adapter
	allow, err := a.IsAllowed(libauth.AuthzRequest{
		Principal: `User::"x"`,
		Action:    `Action::"jwt.rotate"`,
		Resource:  `Resource::"*"`,
	})
	if err != nil {
		t.Fatalf("nil adapter must not error: %v", err)
	}
	if allow {
		t.Fatal("nil adapter must deny")
	}

	empty := &Adapter{}
	allow, err = empty.IsAllowed(libauth.AuthzRequest{
		Principal: `User::"x"`,
		Action:    `Action::"jwt.rotate"`,
		Resource:  `Resource::"*"`,
	})
	if err != nil {
		t.Fatalf("empty adapter must not error: %v", err)
	}
	if allow {
		t.Fatal("empty adapter must deny")
	}
}

func TestLoadSharedFromPathOverride(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bundle.cedar")
	src := `permit (principal, action == Action::"custom.act", resource);`
	if err := os.WriteFile(path, []byte(src), 0o600); err != nil {
		t.Fatal(err)
	}
	ps, err := LoadSharedFromPath(path)
	if err != nil {
		t.Fatalf("LoadSharedFromPath: %v", err)
	}
	a := &Adapter{Policies: ps}
	allow, err := a.IsAllowed(libauth.AuthzRequest{
		Principal: `User::"x"`,
		Action:    `Action::"custom.act"`,
		Resource:  `Resource::"*"`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !allow {
		t.Fatal("custom action must be allowed by overridden bundle")
	}
}
