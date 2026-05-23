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

		// --- notification-svc (mark_all_read: any authenticated user) ------
		// notif.mark_all_read is gated by context.user_id (set by JWT middleware).
		// Unauthenticated requests never reach Cedar (auth.Require blocks them first),
		// so only authenticated-user cases are exercised here.
		{"notif.mark_all_read allow project-manager", "notif.mark_all_read", []string{"project-manager"}, false, true},
		{"notif.mark_all_read allow tenant-admin", "notif.mark_all_read", []string{"tenant-admin"}, false, true},

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
					"user_id":             "sub-1",
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

// TestBundleABACGrid exercises the ABAC forbid layer added in Plan #6
// Task 6. Each row supplies ResourceAttrs (the per-instance attrs the
// libauth middleware would have loaded via a ResourceLoader) plus a
// typed resource UID so Cedar can dereference `resource.tenant_id`.
// The matrix targets cross-tenant denies that pure RBAC could not catch
// and confirms same-tenant requests still resolve through the role permit.
func TestBundleABACGrid(t *testing.T) {
	a := loadEngine(t)

	type row struct {
		name      string
		action    string
		resource  string
		attrs     map[string]any
		roles     []string
		ctxTenant string
		confirm   bool
		wantAllow bool
	}

	// "t-call" is the JWT tenant the request rides on; "t-other" is the
	// tenant the resource actually belongs to. The forbid layer must fire
	// whenever those disagree, even when the role would otherwise allow.
	rows := []row{
		// --- project.read --------------------------------------------------
		{"project.read same-tenant", "project.read", `Project::"p1"`, map[string]any{"tenant_id": "t-call"}, []string{"project-manager"}, "t-call", false, true},
		{"project.read cross-tenant deny", "project.read", `Project::"p1"`, map[string]any{"tenant_id": "t-other"}, []string{"project-manager"}, "t-call", false, false},
		{"project.read no attrs (legacy)", "project.read", `Project::"p1"`, nil, []string{"project-manager"}, "t-call", false, true},
		{"project.read cross-tenant deny tenant-admin", "project.read", `Project::"p1"`, map[string]any{"tenant_id": "t-other"}, []string{"tenant-admin"}, "t-call", false, false},

		// --- project.update / delete --------------------------------------
		{"project.update same-tenant allow", "project.update", `Project::"p1"`, map[string]any{"tenant_id": "t-call"}, []string{"project-manager"}, "t-call", false, true},
		{"project.update cross-tenant deny", "project.update", `Project::"p1"`, map[string]any{"tenant_id": "t-other"}, []string{"project-manager"}, "t-call", false, false},
		{"project.update cross-tenant deny tenant-admin", "project.update", `Project::"p1"`, map[string]any{"tenant_id": "t-other"}, []string{"tenant-admin"}, "t-call", false, false},
		{"project.delete same-tenant platform-admin+confirm allow", "project.delete", `Project::"p1"`, map[string]any{"tenant_id": "t-call"}, []string{"platform-admin"}, "t-call", true, true},
		{"project.delete cross-tenant platform-admin+confirm deny", "project.delete", `Project::"p1"`, map[string]any{"tenant_id": "t-other"}, []string{"platform-admin"}, "t-call", true, false},

		// --- project.task.* ------------------------------------------------
		{"project.task.update same-tenant allow", "project.task.update", `Task::"t1"`, map[string]any{"tenant_id": "t-call"}, []string{"project-manager"}, "t-call", false, true},
		{"project.task.update cross-tenant deny", "project.task.update", `Task::"t1"`, map[string]any{"tenant_id": "t-other"}, []string{"project-manager"}, "t-call", false, false},
		{"project.task.delete cross-tenant deny", "project.task.delete", `Task::"t1"`, map[string]any{"tenant_id": "t-other"}, []string{"project-manager"}, "t-call", false, false},
		{"project.sprint.update cross-tenant deny", "project.sprint.update", `Sprint::"s1"`, map[string]any{"tenant_id": "t-other"}, []string{"project-manager"}, "t-call", false, false},
		{"project.sprint.assign_task cross-tenant deny", "project.sprint.assign_task", `Sprint::"s1"`, map[string]any{"tenant_id": "t-other"}, []string{"project-manager"}, "t-call", false, false},
		{"project.sprint.unassign_task cross-tenant deny", "project.sprint.unassign_task", `Sprint::"s1"`, map[string]any{"tenant_id": "t-other"}, []string{"project-manager"}, "t-call", false, false},

		// --- document.update ----------------------------------------------
		{"document.update same-tenant allow", "document.update", `Document::"d1"`, map[string]any{"tenant_id": "t-call"}, []string{"project-manager"}, "t-call", false, true},
		{"document.update cross-tenant deny", "document.update", `Document::"d1"`, map[string]any{"tenant_id": "t-other"}, []string{"project-manager"}, "t-call", false, false},
		{"document.update cross-tenant deny tenant-admin", "document.update", `Document::"d1"`, map[string]any{"tenant_id": "t-other"}, []string{"tenant-admin"}, "t-call", false, false},

		// --- mfg.* --------------------------------------------------------
		{"mfg.item.update same-tenant allow", "mfg.item.update", `Item::"i1"`, map[string]any{"tenant_id": "t-call"}, []string{"mfg-operator"}, "t-call", false, true},
		{"mfg.item.update cross-tenant deny", "mfg.item.update", `Item::"i1"`, map[string]any{"tenant_id": "t-other"}, []string{"mfg-operator"}, "t-call", false, false},
		{"mfg.bom.activate cross-tenant deny", "mfg.bom.activate", `BOM::"b1"`, map[string]any{"tenant_id": "t-other"}, []string{"mfg-operator"}, "t-call", false, false},
		{"mfg.work_order.update cross-tenant deny", "mfg.work_order.update", `WorkOrder::"w1"`, map[string]any{"tenant_id": "t-other"}, []string{"mfg-operator"}, "t-call", false, false},
		{"mfg.work_order.release cross-tenant deny", "mfg.work_order.release", `WorkOrder::"w1"`, map[string]any{"tenant_id": "t-other"}, []string{"mfg-operator"}, "t-call", false, false},
		{"mfg.work_order.delete cross-tenant platform-admin+confirm deny", "mfg.work_order.delete", `WorkOrder::"w1"`, map[string]any{"tenant_id": "t-other"}, []string{"platform-admin"}, "t-call", true, false},

		// --- quality.* ----------------------------------------------------
		{"quality.apqp.update same-tenant allow", "quality.apqp.update", `APQP::"a1"`, map[string]any{"tenant_id": "t-call"}, []string{"quality-engineer"}, "t-call", false, true},
		{"quality.apqp.update cross-tenant deny", "quality.apqp.update", `APQP::"a1"`, map[string]any{"tenant_id": "t-other"}, []string{"quality-engineer"}, "t-call", false, false},
		{"quality.ppap.update cross-tenant deny", "quality.ppap.update", `PPAP::"p1"`, map[string]any{"tenant_id": "t-other"}, []string{"quality-engineer"}, "t-call", false, false},
		{"quality.fmea.update cross-tenant deny", "quality.fmea.update", `FMEA::"f1"`, map[string]any{"tenant_id": "t-other"}, []string{"quality-engineer"}, "t-call", false, false},
		{"quality.ncr.update cross-tenant deny", "quality.ncr.update", `NCR::"n1"`, map[string]any{"tenant_id": "t-other"}, []string{"quality-engineer"}, "t-call", false, false},
		{"quality.capa.update cross-tenant deny", "quality.capa.update", `CAPA::"c1"`, map[string]any{"tenant_id": "t-other"}, []string{"quality-engineer"}, "t-call", false, false},

		// --- workflow.* ---------------------------------------------------
		{"workflow.update same-tenant allow", "workflow.update", `Workflow::"w1"`, map[string]any{"tenant_id": "t-call"}, []string{"workflow-author"}, "t-call", false, true},
		{"workflow.update cross-tenant deny", "workflow.update", `Workflow::"w1"`, map[string]any{"tenant_id": "t-other"}, []string{"workflow-author"}, "t-call", false, false},
		{"workflow.publish cross-tenant deny", "workflow.publish", `Workflow::"w1"`, map[string]any{"tenant_id": "t-other"}, []string{"workflow-author"}, "t-call", false, false},
		{"workflow.instance.resume cross-tenant deny", "workflow.instance.resume", `Instance::"i1"`, map[string]any{"tenant_id": "t-other"}, []string{"workflow-author"}, "t-call", false, false},
		{"workflow.instance.cancel cross-tenant deny", "workflow.instance.cancel", `Instance::"i1"`, map[string]any{"tenant_id": "t-other"}, []string{"workflow-author"}, "t-call", false, false},
		{"workflow.human_task.complete cross-tenant deny", "workflow.human_task.complete", `HumanTask::"h1"`, map[string]any{"tenant_id": "t-other"}, []string{"workflow-author"}, "t-call", false, false},
		{"workflow.delete cross-tenant platform-admin+confirm deny", "workflow.delete", `Workflow::"w1"`, map[string]any{"tenant_id": "t-other"}, []string{"platform-admin"}, "t-call", true, false},

		// --- report.dashboard.* -------------------------------------------
		{"report.dashboard.update same-tenant allow", "report.dashboard.update", `Dashboard::"d1"`, map[string]any{"tenant_id": "t-call"}, []string{"bi-author"}, "t-call", false, true},
		{"report.dashboard.update cross-tenant deny", "report.dashboard.update", `Dashboard::"d1"`, map[string]any{"tenant_id": "t-other"}, []string{"bi-author"}, "t-call", false, false},
		{"report.dashboard.delete cross-tenant deny", "report.dashboard.delete", `Dashboard::"d1"`, map[string]any{"tenant_id": "t-other"}, []string{"bi-author"}, "t-call", false, false},

		// --- notification-svc (ABAC: resource.user_id == context.user_id) -
		{"notif.read own notification allow", "notif.read", `Notification::"n1"`, map[string]any{"user_id": "sub-1"}, []string{"project-manager"}, "t-call", false, true},
		{"notif.read cross-user deny", "notif.read", `Notification::"n1"`, map[string]any{"user_id": "sub-other"}, []string{"project-manager"}, "t-call", false, false},
		{"notif.read no attrs deny", "notif.read", `Notification::"n1"`, nil, []string{"project-manager"}, "t-call", false, false},
		{"notif.mark_read own notification allow", "notif.mark_read", `Notification::"n1"`, map[string]any{"user_id": "sub-1"}, []string{"project-manager"}, "t-call", false, true},
		{"notif.mark_read cross-user deny", "notif.mark_read", `Notification::"n1"`, map[string]any{"user_id": "sub-other"}, []string{"mfg-operator"}, "t-call", false, false},
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
				Resource:  r.resource,
				Context: map[string]any{
					"roles":               roles,
					"tenant_id":           r.ctxTenant,
					"user_id":             "sub-1",
					"confirm_destructive": r.confirm,
				},
				ResourceAttrs: r.attrs,
			})
			if err != nil {
				t.Fatalf("IsAllowed(%s): %v", r.action, err)
			}
			if allow != r.wantAllow {
				t.Fatalf("action=%s roles=%v attrs=%v ctxTenant=%s: got allow=%v want=%v",
					r.action, roles, r.attrs, r.ctxTenant, allow, r.wantAllow)
			}
		})
	}
}

// TestNotifMarkAllRead_DenyEmptyUserID verifies that notif.mark_all_read is
// denied when context.user_id is empty. The permit guard requires
// context.user_id != "" so an empty string must yield deny.
func TestNotifMarkAllRead_DenyEmptyUserID(t *testing.T) {
	a := loadEngine(t)
	allow, err := a.IsAllowed(libauth.AuthzRequest{
		Principal: `User::"sub-1"`,
		Action:    `Action::"notif.mark_all_read"`,
		Resource:  `Resource::"*"`,
		Context: map[string]any{
			"roles":               []string{"project-manager"},
			"tenant_id":           "t1",
			"user_id":             "",
			"confirm_destructive": false,
		},
	})
	if err != nil {
		t.Fatalf("IsAllowed: %v", err)
	}
	if allow {
		t.Fatal("notif.mark_all_read with empty user_id must be denied")
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
