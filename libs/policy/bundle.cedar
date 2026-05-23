// Cedar policy bundle for identity-svc.
// Loaded into an in-memory policy.Engine at service startup.
// When a runtime-editable store is wired (delegated to db-migration-steward),
// move these policies into the policy_bundle table and load from there.

// --- Platform admin ---------------------------------------------------------

// Super-role: platform-admin members may invoke any action on any resource.
// Forbid rules (destructive actions requiring X-Confirm-Destructive, cross-
// tenant ABAC denies) still apply via Cedar's forbid > permit precedence.
permit (
  principal,
  action,
  resource
)
when { context.roles.contains("platform-admin") };

// Allow JWT signing-key rotation only to platform-admin members.
permit (
  principal,
  action == Action::"jwt.rotate",
  resource
)
when { context.roles.contains("platform-admin") };

// Allow runtime policy bundle reload only to platform-admin members.
// (Reserved for the policy.reload admin endpoint added in Plan #4 Task 6.)
permit (
  principal,
  action == Action::"policy.reload",
  resource
)
when { context.roles.contains("platform-admin") };

// Allow OIDC SSO config CRUD only to tenant-admin members. Per-instance
// ABAC for sso_config rows is Plan #6 Task 6 territory; for now this uses
// resource "*" which the middleware wraps as Resource::"*".
permit (
  principal,
  action == Action::"tenant.sso.configure",
  resource
)
when { context.roles.contains("tenant-admin") };

// --- Sample CRUD policies (placeholders; not yet enforced elsewhere) -------

// Tenants: only platform-admin may create/delete tenants; tenant-admin may update.
permit (
  principal,
  action in [Action::"tenant.create", Action::"tenant.delete"],
  resource
)
when { context.roles.contains("platform-admin") };

permit (
  principal,
  action == Action::"tenant.update",
  resource
)
when {
  context.roles.contains("platform-admin") ||
  context.roles.contains("tenant-admin")
};

// Projects: project-manager and tenant-admin may write across the project
// surface (projects, tasks, dependencies, sprints, sprint-task assignment).
// Per-instance scoping (Project::"<id>", Task::"<id>", Sprint::"<id>") is a
// Plan #4 polish / Plan #6 ABAC follow-up; for now the action grid uses
// resource "*". Actions enumerated from ADR-0002 §project-svc WRITE_GUARD rows.
permit (
  principal,
  action in [
    Action::"project.create",
    Action::"project.update",
    Action::"project.delete",
    Action::"project.task.create",
    Action::"project.task.update",
    Action::"project.task.delete",
    Action::"project.task.add_dependency",
    Action::"project.task.remove_dependency",
    Action::"project.sprint.create",
    Action::"project.sprint.update",
    Action::"project.sprint.assign_task",
    Action::"project.sprint.unassign_task"
  ],
  resource
)
when {
  context.roles.contains("tenant-admin") ||
  context.roles.contains("project-manager")
};

permit (
  principal,
  action == Action::"project.read",
  resource
);

// Documents: project-manager and tenant-admin may write across the document
// surface (workspaces, documents, versions, comments, templates). Per-instance
// scoping (Document::"<id>" / Comment::"<id>") is a Plan #4 polish / Plan #6
// ABAC follow-up; for now the action grid uses resource "*".
permit (
  principal,
  action in [
    Action::"document.workspace.ensure",
    Action::"document.create",
    Action::"document.update",
    Action::"document.delete",
    Action::"document.restore",
    Action::"document.comment.create",
    Action::"document.comment.resolve",
    Action::"document.comment.delete",
    Action::"document.template.create"
  ],
  resource
)
when {
  context.roles.contains("tenant-admin") ||
  context.roles.contains("project-manager")
};

// Manufacturing: tenant-admin and mfg-operator may write across the mfg
// surface (items, UOMs, BOMs, routings, work centers, work orders, lots,
// MRP runs). Per-instance scoping (Item::"<id>", BOM::"<id>",
// WorkOrder::"<id>", etc.) is a Plan #4 polish / Plan #6 ABAC follow-up;
// for now the action grid uses resource "*".
permit (
  principal,
  action in [
    Action::"mfg.uom.create",
    Action::"mfg.item.create",
    Action::"mfg.item.update",
    Action::"mfg.item.delete",
    Action::"mfg.bom.create",
    Action::"mfg.bom.update",
    Action::"mfg.bom.add_line",
    Action::"mfg.bom.activate",
    Action::"mfg.bom.update_line",
    Action::"mfg.bom.delete_line",
    Action::"mfg.routing.create",
    Action::"mfg.routing.update",
    Action::"mfg.routing.add_operation",
    Action::"mfg.routing.update_operation",
    Action::"mfg.routing.delete_operation",
    Action::"mfg.work_center.create",
    Action::"mfg.work_center.update",
    Action::"mfg.work_order.create",
    Action::"mfg.work_order.update",
    Action::"mfg.work_order.delete",
    Action::"mfg.work_order.release",
    Action::"mfg.lot.create",
    Action::"mfg.lot.update_status",
    Action::"mfg.lot.add_genealogy",
    Action::"mfg.mrp.run"
  ],
  resource
)
when {
  context.roles.contains("tenant-admin") ||
  context.roles.contains("mfg-operator")
};

// Quality: tenant-admin and quality-engineer may write across the quality
// surface (APQP, PPAP, FMEA, control plans, inspections, NCRs, CAPA).
// Per-instance scoping (APQP::"<id>", PPAP::"<id>", FMEA::"<id>",
// ControlPlan::"<id>", NCR::"<id>", CAPA::"<id>", etc.) is a Plan #4 polish /
// Plan #6 ABAC follow-up; for now the action grid uses resource "*".
permit (
  principal,
  action in [
    Action::"quality.apqp.create",
    Action::"quality.apqp.update",
    Action::"quality.apqp.delete",
    Action::"quality.ppap.create",
    Action::"quality.ppap.update",
    Action::"quality.ppap.delete",
    Action::"quality.ppap.update_element",
    Action::"quality.fmea.create",
    Action::"quality.fmea.update",
    Action::"quality.fmea.delete",
    Action::"quality.fmea.add_mode",
    Action::"quality.fmea.update_mode",
    Action::"quality.fmea.delete_mode",
    Action::"quality.control_plan.create",
    Action::"quality.control_plan.update",
    Action::"quality.control_plan.add_characteristic",
    Action::"quality.control_plan.update_characteristic",
    Action::"quality.control_plan.delete_characteristic",
    Action::"quality.inspection.create",
    Action::"quality.ncr.create",
    Action::"quality.ncr.update",
    Action::"quality.ncr.create_capa",
    Action::"quality.capa.update"
  ],
  resource
)
when {
  context.roles.contains("tenant-admin") ||
  context.roles.contains("quality-engineer")
};

// Workflow: tenant-admin and workflow-author may write across the workflow
// surface (definitions, versions, publish, instances, human-task completion).
// Per-instance scoping (Workflow::"<id>", WorkflowVersion::"<id>",
// Instance::"<id>", HumanTask::"<id>") is a Plan #4 polish / Plan #6 ABAC
// follow-up; for now the action grid uses resource "*".
permit (
  principal,
  action in [
    Action::"workflow.create",
    Action::"workflow.update",
    Action::"workflow.delete",
    Action::"workflow.version.create",
    Action::"workflow.publish",
    Action::"workflow.instance.start",
    Action::"workflow.instance.resume",
    Action::"workflow.instance.cancel",
    Action::"workflow.human_task.complete"
  ],
  resource
)
when {
  context.roles.contains("tenant-admin") ||
  context.roles.contains("workflow-author")
};

// Dashboards (legacy): viewer can read, editor can write.
// NOTE: ADR-0002 renamed these to `report.dashboard.*` (see permit block
// below). The legacy `dashboard.*` actions are kept here for backwards
// compatibility with any callers still using the old action names; do not
// rely on them for new code.
permit (
  principal,
  action == Action::"dashboard.read",
  resource
)
when {
  context.roles.contains("dashboard-viewer") ||
  context.roles.contains("dashboard-editor") ||
  context.roles.contains("tenant-admin")
};

permit (
  principal,
  action in [Action::"dashboard.create", Action::"dashboard.update", Action::"dashboard.delete"],
  resource
)
when {
  context.roles.contains("dashboard-editor") ||
  context.roles.contains("tenant-admin")
};

// Reports / Dashboards: tenant-admin and bi-author may write across the
// reports-svc dashboard surface (create / update / delete). Per-instance
// scoping (Dashboard::"<id>") is a Plan #4 polish / Plan #6 ABAC follow-up;
// for now the action grid uses resource "*". Action names match ADR-0002
// §reports-svc (service-prefixed: report.dashboard.*).
permit (
  principal,
  action in [
    Action::"report.dashboard.create",
    Action::"report.dashboard.update",
    Action::"report.dashboard.delete"
  ],
  resource
)
when {
  context.roles.contains("tenant-admin") ||
  context.roles.contains("bi-author")
};

// --- ABAC: per-instance tenant scoping (Plan #6 Task 6 Step 4) -------------
//
// These rules layer on top of the role-based permits above. They DO NOT
// replace them — Cedar requires at least one matching `permit` for any
// allow decision — but they tighten the safety net so a manufactured request
// with a forged tenant_id cannot read or update a resource owned by another
// tenant.
//
// The middleware-resolved resource carries attributes loaded from the
// service's store (`tenant_id`, `owner_user`). Policies here are written so
// the absence of those attributes (e.g. create endpoints, legacy callers,
// loaders returning {} for unknown types) is a no-op rather than a deny —
// the underlying role permit still governs in that case.

// Project read: deny when the resource declares a tenant_id that disagrees
// with the caller's tenant context. Encoded as a forbid so it overrides any
// over-broad permit. The `has` guards keep this from firing on resources
// without loaded attrs.
forbid (
  principal,
  action == Action::"project.read",
  resource
)
when {
  resource has tenant_id &&
  resource.tenant_id != context.tenant_id
};

// Document read: same pattern as project.read — never cross tenants.
forbid (
  principal,
  action == Action::"document.update",
  resource
)
when {
  resource has tenant_id &&
  resource.tenant_id != context.tenant_id
};

// Project write actions: forbid mutating a project that belongs to a
// different tenant, regardless of which role the principal holds.
forbid (
  principal,
  action in [
    Action::"project.update",
    Action::"project.delete",
    Action::"project.task.update",
    Action::"project.task.delete",
    Action::"project.sprint.update",
    Action::"project.sprint.assign_task",
    Action::"project.sprint.unassign_task"
  ],
  resource
)
when {
  resource has tenant_id &&
  resource.tenant_id != context.tenant_id
};

// Mfg write actions: forbid mutating items / boms / work orders that belong
// to a different tenant.
forbid (
  principal,
  action in [
    Action::"mfg.item.update",
    Action::"mfg.item.delete",
    Action::"mfg.bom.update",
    Action::"mfg.bom.activate",
    Action::"mfg.work_order.update",
    Action::"mfg.work_order.delete",
    Action::"mfg.work_order.release"
  ],
  resource
)
when {
  resource has tenant_id &&
  resource.tenant_id != context.tenant_id
};

// Quality / Workflow / Reports write actions: same cross-tenant guard.
forbid (
  principal,
  action in [
    Action::"quality.apqp.update",
    Action::"quality.apqp.delete",
    Action::"quality.ppap.update",
    Action::"quality.ppap.delete",
    Action::"quality.fmea.update",
    Action::"quality.fmea.delete",
    Action::"quality.control_plan.update",
    Action::"quality.ncr.update",
    Action::"quality.capa.update",
    Action::"workflow.update",
    Action::"workflow.delete",
    Action::"workflow.publish",
    Action::"workflow.instance.resume",
    Action::"workflow.instance.cancel",
    Action::"workflow.human_task.complete",
    Action::"report.dashboard.update",
    Action::"report.dashboard.delete"
  ],
  resource
)
when {
  resource has tenant_id &&
  resource.tenant_id != context.tenant_id
};

// --- Platform-admin overlay for destructive actions ------------------------
//
// Without this overlay the destructive permits would resolve only via the
// service-role blocks above (tenant-admin / project-manager / workflow-author /
// mfg-operator). The forbid block immediately below rejects every role except
// platform-admin, so platform-admin must be explicitly named as a permit
// principal for the destructive actions to ever resolve to Allow.
permit (
  principal,
  action in [
    Action::"tenant.delete",
    Action::"project.delete",
    Action::"workflow.delete",
    Action::"mfg.work_order.delete"
  ],
  resource
)
when { context.roles.contains("platform-admin") };

// --- Destructive-action guards ---------------------------------------------
//
// Cedar evaluates `forbid` after `permit`; a matching forbid overrides any
// permit. The destructive-DELETE actions below require BOTH platform-admin
// role AND an explicit `X-Confirm-Destructive: true` header, which the
// authz middleware (libs/go/auth/authz.go) folds into the Cedar context as
// `confirm_destructive`. Without both, the request is denied even if the
// matching permit block would otherwise allow it (e.g. tenant-admin trying
// to delete a project).
//
// Actions guarded: tenant.delete, project.delete, workflow.delete,
// mfg.work_order.delete (closest lot-recall / production-destroy action in
// the current bundle; `mfg.lot.delete` is not yet defined). `audit.purge`
// is not yet defined either — audit-svc is read-only by design.

forbid (
  principal,
  action == Action::"tenant.delete",
  resource
)
unless {
  context.roles.contains("platform-admin") &&
  context.confirm_destructive == true
};

forbid (
  principal,
  action == Action::"project.delete",
  resource
)
unless {
  context.roles.contains("platform-admin") &&
  context.confirm_destructive == true
};

forbid (
  principal,
  action == Action::"workflow.delete",
  resource
)
unless {
  context.roles.contains("platform-admin") &&
  context.confirm_destructive == true
};

forbid (
  principal,
  action == Action::"mfg.work_order.delete",
  resource
)
unless {
  context.roles.contains("platform-admin") &&
  context.confirm_destructive == true
};
