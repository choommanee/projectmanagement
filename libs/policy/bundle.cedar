// Cedar policy bundle for identity-svc.
// Loaded into an in-memory policy.Engine at service startup.
// When a runtime-editable store is wired (delegated to db-migration-steward),
// move these policies into the policy_bundle table and load from there.

// --- Platform admin ---------------------------------------------------------

// Allow JWT signing-key rotation only to platform-admin members.
permit (
  principal,
  action == Action::"jwt.rotate",
  resource
)
when { context.roles.contains("platform-admin") };

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

// Projects: project-manager and tenant-admin may write; anyone authenticated may read.
permit (
  principal,
  action in [Action::"project.create", Action::"project.update", Action::"project.delete"],
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

// Dashboards: viewer can read, editor can write.
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
