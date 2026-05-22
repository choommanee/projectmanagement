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
