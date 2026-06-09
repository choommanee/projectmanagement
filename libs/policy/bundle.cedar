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

// Allow importing an operator-provided X.509 document-signing certificate
// (BYO cert) only to platform-admin members. Backs document-svc
// POST/GET /v1/admin/sign-cert (atomic swap of the active signing identity).
permit (
  principal,
  action == Action::"document.sign.cert.import",
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

// --- Identity: user management ---

// Only tenant-admin (and platform-admin via the super-permit above) may invite,
// update, or deactivate users within their tenant.
permit (
  principal,
  action in [
    Action::"identity.user.create",
    Action::"identity.user.update",
    Action::"identity.user.delete"
  ],
  resource
)
when {
  context.roles.contains("tenant-admin") ||
  context.roles.contains("platform-admin")
};

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
    Action::"project.task.comment.update",
    Action::"project.task.comment.delete",
    Action::"project.task.worklog.update",
    Action::"project.task.worklog.delete",
    Action::"project.sprint.create",
    Action::"project.sprint.update",
    Action::"project.sprint.delete",
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
    Action::"document.template.create",
    Action::"document.template.update",
    Action::"document.template.delete",
    Action::"document.sign.envelope.create",
    Action::"document.sign.send",
    Action::"document.sign.void"
  ],
  resource
)
when {
  context.roles.contains("tenant-admin") ||
  context.roles.contains("project-manager")
};

// --- Service-to-service: workflow-service role -----------------------------
//
// The Rust workflow runtime engine, brokered through workflow-svc, calls
// document-svc and project-svc to materialize side effects of a running
// workflow (create_document / request_signature / create_task /
// update_task_status). Those calls carry a short-lived service JWT minted by
// identity-svc's POST /v1/internal/service-token endpoint with
// Roles=["workflow-service"] and an explicit TenantID (no RLS bypass — the
// tenant rides in the token like any user token). This permit grants the
// MINIMAL action set those four engine actions require; nothing else.
//
// Security posture: the service token is short-lived (~10m), still verified
// through the normal JWKS path, and minted only behind a shared-secret
// (SERVICE_TOKEN_SECRET) gate over the internal network. The cross-tenant
// forbid layer above still applies, so a workflow-service token scoped to
// tenant A cannot mutate tenant B's resources.
permit (
  principal,
  action in [
    Action::"document.create",
    Action::"document.sign.envelope.create",
    Action::"document.sign.send",
    Action::"project.task.create",
    Action::"project.task.update"
  ],
  resource
)
when { context.roles.contains("workflow-service") };

// Signer actions (view / sign / decline / OTP step-up request) are open to
// any authenticated HUMAN user within the tenant — the actual signer must
// match the routed signer row, which the service layer enforces. Cedar gates
// by authenticated principal here; the JWT middleware guarantees a principal
// before this runs. document.sign.otp.request mirrors document.sign.sign:
// it issues the email-OTP challenge an email_otp signer must verify to sign.
//
// The workflow-service service principal is explicitly EXCLUDED: per the
// ADR-0002 least-privilege table it only gets document.create /
// sign.envelope.create / sign.send / project.task.*, never the act-as-a-signer
// surface. A service token has no concrete user-UUID identity, so granting it
// these actions would let it sign/decline ANY signer row (the service layer's
// requireActor also fails closed on nil actor — this is the matching Cedar
// layer of that defense-in-depth).
permit (
  principal,
  action in [
    Action::"document.sign.view",
    Action::"document.sign.sign",
    Action::"document.sign.decline",
    Action::"document.sign.otp.request"
  ],
  resource
)
when {
  context.user_id != "" &&
  !context.roles.contains("workflow-service")
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
    Action::"mfg.uom.delete",
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
    Action::"mfg.work_center.delete",
    Action::"mfg.work_order.create",
    Action::"mfg.work_order.update",
    Action::"mfg.work_order.delete",
    Action::"mfg.work_order.release",
    Action::"mfg.lot.create",
    Action::"mfg.lot.delete",
    Action::"mfg.lot.update_status",
    Action::"mfg.lot.add_genealogy",
    Action::"mfg.mrp.run",
    Action::"mfg.inventory.post",
    Action::"mfg.supplier.create",
    Action::"mfg.supplier.update",
    Action::"mfg.supplier.delete",
    Action::"mfg.po.create",
    Action::"mfg.po.update",
    Action::"mfg.po.add_line",
    Action::"mfg.po.update_line",
    Action::"mfg.po.delete_line"
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
    Action::"workflow.instance.retry",
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

// Document sign actions: never let a caller create/send/void an envelope or
// mint a public verification link for a resource owned by another tenant.
// cedar_loader resolves Document::tenant_id and SignEnvelope::tenant_id, so
// the forbid fires whenever the loaded tenant disagrees with the JWT tenant
// context. Same no-op-on-missing-attrs shape as document.update above.
forbid (
  principal,
  action in [
    Action::"document.sign.envelope.create",
    Action::"document.sign.send",
    Action::"document.sign.void",
    Action::"document.sign.verify_link.create"
  ],
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
    Action::"project.sprint.delete",
    Action::"project.sprint.assign_task",
    Action::"project.sprint.unassign_task"
  ],
  resource
)
when {
  resource has tenant_id &&
  resource.tenant_id != context.tenant_id
};

// Mfg write actions: forbid mutating items / boms / work orders / procurement
// that belong to a different tenant.
forbid (
  principal,
  action in [
    Action::"mfg.item.update",
    Action::"mfg.item.delete",
    Action::"mfg.bom.update",
    Action::"mfg.bom.activate",
    Action::"mfg.work_center.delete",
    Action::"mfg.work_order.update",
    Action::"mfg.work_order.delete",
    Action::"mfg.work_order.release",
    Action::"mfg.supplier.update",
    Action::"mfg.supplier.delete",
    Action::"mfg.po.update"
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
    Action::"workflow.instance.retry",
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

// --- notification-svc ---

// All authenticated users can read their own notifications.
// ABAC: resource.user_id must match the caller's user_id in context.
permit (
  principal,
  action == Action::"notif.read",
  resource
)
when {
  context has roles &&
  resource has user_id &&
  resource.user_id == context.user_id
};

// Collection read — list endpoint uses Notification::"*" resource
permit (
  principal,
  action == Action::"notif.read",
  resource == Notification::"*"
)
when {
  context.user_id != ""
};

// Mark one notification read — own only.
permit (
  principal,
  action == Action::"notif.mark_read",
  resource
)
when {
  context has roles &&
  resource has user_id &&
  resource.user_id == context.user_id
};

// Mark all read — tenant-scoped, any authenticated user for their own.
// context.user_id is set by the JWT middleware for every authenticated request.
// context.user_id is always present; non-empty check suffices
permit (
  principal,
  action == Action::"notif.mark_all_read",
  resource
)
when {
  context.user_id != ""
};

// --- sales-svc ---

permit (
  principal,
  action in [
    Action::"sales.customer.create",
    Action::"sales.customer.update",
    Action::"sales.customer.delete",
    Action::"sales.order.create",
    Action::"sales.order.update",
    Action::"sales.order.delete",
    Action::"sales.quotation.create",
    Action::"sales.quotation.update",
    Action::"sales.quotation.delete",
    Action::"sales.invoice.create",
    Action::"sales.invoice.update",
    Action::"sales.invoice.delete",
    Action::"sales.shipment.create",
    Action::"sales.shipment.update",
    Action::"sales.shipment.delete",
    Action::"sales.opportunity.create",
    Action::"sales.opportunity.update",
    Action::"sales.opportunity.delete"
  ],
  resource
)
when {
  context.roles.contains("project-manager") ||
  context.roles.contains("tenant-admin")
};

// Prevent cross-tenant mutation
forbid (principal, action in [Action::"sales.customer.update", Action::"sales.customer.delete", Action::"sales.order.update", Action::"sales.order.delete"], resource)
when { resource has tenant_id && resource.tenant_id != context.tenant_id };

// --- accounting-svc ---

permit (
  principal,
  action in [
    Action::"accounting.account.create",
    Action::"accounting.account.update",
    Action::"accounting.account.delete",
    Action::"accounting.je.create",
    Action::"accounting.je.update",
    Action::"accounting.je.post",
    Action::"accounting.invoice.create",
    Action::"accounting.invoice.update",
    Action::"accounting.invoice.delete",
    Action::"accounting.budget.set"
  ],
  resource
)
when {
  context.roles.contains("tenant-admin") ||
  context.roles.contains("project-manager")
};

// --- hr-svc ---

permit (
  principal,
  action in [
    Action::"hr.department.create",
    Action::"hr.department.update",
    Action::"hr.department.delete",
    Action::"hr.position.create",
    Action::"hr.position.update",
    Action::"hr.position.delete",
    Action::"hr.employee.create",
    Action::"hr.employee.update",
    Action::"hr.employee.terminate"
  ],
  resource
)
when {
  context.roles.contains("tenant-admin") ||
  context.roles.contains("project-manager")
};

// Payroll: only tenant-admin and platform-admin may create, approve, or pay
// payslips. platform-admin is already covered by the super-permit at the top,
// but these explicit blocks document the intent and satisfy RequireAction checks.
permit (
  principal,
  action in [
    Action::"hr.payslip.create",
    Action::"hr.payslip.approve",
    Action::"hr.payslip.pay"
  ],
  resource
)
when {
  context.roles.contains("tenant-admin") ||
  context.roles.contains("platform-admin")
};

// Leave: tenant-admin, platform-admin, and project-manager may create leave
// requests. Approval/rejection is restricted to tenant-admin and platform-admin.
permit (
  principal,
  action == Action::"hr.leave.create",
  resource
)
when {
  context.roles.contains("platform-admin") ||
  context.roles.contains("tenant-admin") ||
  context.roles.contains("project-manager")
};

permit (
  principal,
  action == Action::"hr.leave.approve",
  resource
)
when {
  context.roles.contains("platform-admin") ||
  context.roles.contains("tenant-admin")
};

// Public verification links (document-svc, Team F): minting/revoking a
// public share link for a completed signing envelope mirrors the
// document.sign.send permit set — tenant-admin / project-manager for humans,
// plus the workflow-service service principal so automated flows can attach
// a verification link to documents they routed for signature. The PUBLIC
// lookup endpoint (GET /public/verify/{token}) is deliberately outside
// Cedar: its sole credential is the 256-bit token.
permit (
  principal,
  action == Action::"document.sign.verify_link.create",
  resource
)
when {
  context.roles.contains("tenant-admin") ||
  context.roles.contains("project-manager") ||
  context.roles.contains("workflow-service")
};
