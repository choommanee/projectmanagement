# 2. Cedar Action × Resource Matrix

Status: Accepted
Date: 2026-05-22

## Context

Plan #2 wired the Cedar policy engine into `identity-svc` and shipped a small
bundle (`services/identity-svc/internal/policy/bundle.cedar`) that already
references actions like `jwt.rotate`, `tenant.create`, `project.update`, and
`dashboard.read`. Plan #4 extends Cedar enforcement to every product service's
HTTP middleware (`RequireAction(action, resourceFn)`). Before any service can
be wired we need a single source of truth that names every Cedar
`(action, resource)` pair the platform will check at the edge.

This ADR is that source of truth. Each row maps an HTTP endpoint to its Cedar
action and the resource entity reference the policy engine will receive.
Plan #4 implementers MUST consult this table when adding `RequireAction`
middleware; Plan #6 will revisit the `READ_ONLY` rows when read-side ABAC is
introduced (currently those endpoints fall back to `auth.Require` JWT-only
checks).

## Decision

### Naming convention

- **Action** — `<service>.<entity>.<verb>` in lower-snake-case.
  - `<service>` matches the service short-name (`tenant`, `project`,
    `document`, `mfg`, `quality`, `workflow`, `report`, `audit`).
  - `<entity>` is the singular noun of the deepest resource (`task`,
    `work_order`, `ncr`, `dashboard`).
  - `<verb>` describes the conceptual operation, not the HTTP method —
    `POST /v1/work-orders/{id}/release` becomes `mfg.work_order.release`,
    not `mfg.work_order.create`.
- **Resource** — Cedar entity reference of the form `Entity::"<id>"` for
  instance-scoped operations (where `<id>` is the path parameter) or
  `Entity::"*"` for tenant-wide collection endpoints (create / list). The
  table writes the resource template; the middleware resolves the actual id
  at request time from chi URL params.
- **Sub-resources** collapse to one action per leaf endpoint. For example,
  `POST /v1/projects/{id}/tasks` becomes a single `project.task.create`
  action whose resource is the parent `Project::"<id>"` (so policies can
  scope by project).
- **Batch endpoints** get their own verb suffix (`batch_create`,
  `batch_update`) to disambiguate from the unit operation. None exist
  today; the convention is documented for future endpoints.

### Roles referenced by policies

The following role names appear (or will appear) in `bundle.cedar`. The
`context.roles` claim on the JWT is checked via `contains(...)`:

| Role               | Description                                                                      |
| ------------------ | -------------------------------------------------------------------------------- |
| `platform-admin`   | Cross-tenant superuser; can rotate JWT keys, create/delete tenants.              |
| `tenant-admin`     | Tenant-scoped superuser; manages users, projects, settings within their tenant.  |
| `project-manager`  | Owns project/task/sprint lifecycle (create/update/delete projects and tasks).    |
| `mfg-operator`     | Day-to-day MFG operations: work orders, lots, BOM/routing maintenance.           |
| `quality-engineer` | APQP/PPAP/FMEA/control-plan authoring, NCR/CAPA closure.                         |
| `workflow-author`  | Designs and publishes workflow definitions; starts/cancels instances.            |
| `bi-author`        | Creates and edits BI dashboards and report widgets.                              |

`dashboard-viewer` / `dashboard-editor` exist in the current bundle as
placeholders and will be folded into the `bi-author` / `tenant-admin` roles
above during Plan #4.

### Guard column

- `WRITE_GUARD` — endpoint mutates persistent state. Plan #4 MUST wrap the
  handler in `RequireAction(action, resourceFn)` (Cedar) on top of the
  existing `auth.Require` JWT guard.
- `READ_ONLY` — pure read. Plan #4 leaves the existing `auth.Require` JWT
  guard in place; Plan #6 will add row-scoped ABAC where appropriate.

## Consequences

- Every new write endpoint added after this ADR MUST declare a Cedar action
  before merge; CI lint (added in Plan #4 Task 7) verifies the action
  appears in this table.
- The Cedar bundle (`identity-svc/internal/policy/bundle.cedar`) gains one
  `permit` rule per role × action group; new product services bind to the
  same engine via the policy gRPC client introduced in Plan #4.
- Resource templates are advisory — middleware constructs the actual Cedar
  entity at request time. Renaming an action here is a breaking change and
  requires a coordinated bundle update + middleware change.
- `Tenant::"*"` is used for collection endpoints (list / create at the
  top of a resource hierarchy) so policies can be written as
  `resource == Tenant::"<tid>"` without branching on path shape.

## Action × resource matrix

Rows are grouped by service. Within each service, `WRITE_GUARD` rows are
listed first, then `READ_ONLY`.

### tenant-svc (`services/tenant-svc`)

Route base: `/v1/tenants`.

| Method | Path                          | Action            | Resource         | Guard       |
| ------ | ----------------------------- | ----------------- | ---------------- | ----------- |
| POST   | `/v1/tenants/`                | `tenant.create`   | `Tenant::"*"`    | WRITE_GUARD |
| PATCH  | `/v1/tenants/{id}`            | `tenant.update`   | `Tenant::"<id>"` | WRITE_GUARD |
| DELETE | `/v1/tenants/{id}`            | `tenant.delete`   | `Tenant::"<id>"` | WRITE_GUARD |
| GET    | `/v1/tenants/`                | `tenant.list`     | `Tenant::"*"`    | READ_ONLY   |
| GET    | `/v1/tenants/{id}`            | `tenant.read`     | `Tenant::"<id>"` | READ_ONLY   |
| GET    | `/v1/tenants/by-slug/{slug}`  | `tenant.read`     | `Tenant::"*"`    | READ_ONLY   |

> `tenant.user.invite` is reserved for the user-invite endpoint that
> identity-svc will add in Plan #4 Task 9; it does not yet appear in
> tenant-svc.

### project-svc (`services/project-svc`)

Route base: `/v1`.

| Method | Path                                       | Action                          | Resource          | Guard       |
| ------ | ------------------------------------------ | ------------------------------- | ----------------- | ----------- |
| POST   | `/v1/projects`                             | `project.create`                | `Tenant::"*"`     | WRITE_GUARD |
| PATCH  | `/v1/projects/{id}`                        | `project.update`                | `Project::"<id>"` | WRITE_GUARD |
| DELETE | `/v1/projects/{id}`                        | `project.delete`                | `Project::"<id>"` | WRITE_GUARD |
| POST   | `/v1/projects/{id}/tasks`                  | `project.task.create`           | `Project::"<id>"` | WRITE_GUARD |
| PATCH  | `/v1/tasks/{id}`                           | `project.task.update`           | `Task::"<id>"`    | WRITE_GUARD |
| DELETE | `/v1/tasks/{id}`                           | `project.task.delete`           | `Task::"<id>"`    | WRITE_GUARD |
| POST   | `/v1/tasks/{id}/dependencies`              | `project.task.add_dependency`   | `Task::"<id>"`    | WRITE_GUARD |
| DELETE | `/v1/dependencies/{id}`                    | `project.task.remove_dependency`| `Dependency::"<id>"` | WRITE_GUARD |
| POST   | `/v1/projects/{id}/sprints`                | `project.sprint.create`         | `Project::"<id>"` | WRITE_GUARD |
| PATCH  | `/v1/sprints/{id}`                         | `project.sprint.update`         | `Sprint::"<id>"`  | WRITE_GUARD |
| POST   | `/v1/sprints/{id}/tasks/{taskId}`          | `project.sprint.assign_task`    | `Sprint::"<id>"`  | WRITE_GUARD |
| DELETE | `/v1/sprints/{id}/tasks/{taskId}`          | `project.sprint.unassign_task`  | `Sprint::"<id>"`  | WRITE_GUARD |
| GET    | `/v1/projects`                             | `project.list`                  | `Tenant::"*"`     | READ_ONLY   |
| GET    | `/v1/projects/{id}`                        | `project.read`                  | `Project::"<id>"` | READ_ONLY   |
| GET    | `/v1/projects/{id}/tasks`                  | `project.task.list`             | `Project::"<id>"` | READ_ONLY   |
| GET    | `/v1/tasks`                                | `project.task.list`             | `Tenant::"*"`     | READ_ONLY   |
| GET    | `/v1/tasks/{id}`                           | `project.task.read`             | `Task::"<id>"`    | READ_ONLY   |
| GET    | `/v1/projects/{id}/sprints`                | `project.sprint.list`           | `Project::"<id>"` | READ_ONLY   |
| GET    | `/v1/sprints/{id}`                         | `project.sprint.read`           | `Sprint::"<id>"`  | READ_ONLY   |
| GET    | `/v1/sprints/{id}/tasks`                   | `project.sprint.list_tasks`     | `Sprint::"<id>"`  | READ_ONLY   |

### document-svc (`services/document-svc`)

Route base: `/v1`.

| Method | Path                                       | Action                          | Resource             | Guard       |
| ------ | ------------------------------------------ | ------------------------------- | -------------------- | ----------- |
| POST   | `/v1/workspaces`                           | `document.workspace.ensure`     | `Tenant::"*"`        | WRITE_GUARD |
| POST   | `/v1/documents`                            | `document.create`               | `Tenant::"*"`        | WRITE_GUARD |
| PATCH  | `/v1/documents/{id}`                       | `document.update`               | `Document::"<id>"`   | WRITE_GUARD |
| DELETE | `/v1/documents/{id}`                       | `document.delete`               | `Document::"<id>"`   | WRITE_GUARD |
| POST   | `/v1/documents/{id}/restore`               | `document.restore`              | `Document::"<id>"`   | WRITE_GUARD |
| POST   | `/v1/documents/{id}/comments`              | `document.comment.create`       | `Document::"<id>"`   | WRITE_GUARD |
| PATCH  | `/v1/comments/{id}/resolve`                | `document.comment.resolve`      | `Comment::"<id>"`    | WRITE_GUARD |
| DELETE | `/v1/comments/{id}`                        | `document.comment.delete`       | `Comment::"<id>"`    | WRITE_GUARD |
| POST   | `/v1/templates`                            | `document.template.create`      | `Tenant::"*"`        | WRITE_GUARD |
| GET    | `/v1/workspaces`                           | `document.workspace.list`       | `Tenant::"*"`        | READ_ONLY   |
| GET    | `/v1/documents`                            | `document.list`                 | `Tenant::"*"`        | READ_ONLY   |
| GET    | `/v1/documents/{id}`                       | `document.read`                 | `Document::"<id>"`   | READ_ONLY   |
| GET    | `/v1/documents/{id}/versions`              | `document.version.list`         | `Document::"<id>"`   | READ_ONLY   |
| GET    | `/v1/documents/{id}/versions/{rev}`        | `document.version.read`         | `Document::"<id>"`   | READ_ONLY   |
| GET    | `/v1/documents/{id}/comments`              | `document.comment.list`         | `Document::"<id>"`   | READ_ONLY   |
| GET    | `/v1/templates`                            | `document.template.list`        | `Tenant::"*"`        | READ_ONLY   |
| GET    | `/v1/templates/{id}`                       | `document.template.read`        | `Template::"<id>"`   | READ_ONLY   |

### mfg-svc (`services/mfg-svc`)

Route base: `/v1`.

| Method | Path                                              | Action                              | Resource              | Guard       |
| ------ | ------------------------------------------------- | ----------------------------------- | --------------------- | ----------- |
| POST   | `/v1/uoms`                                        | `mfg.uom.create`                    | `Tenant::"*"`         | WRITE_GUARD |
| POST   | `/v1/items`                                       | `mfg.item.create`                   | `Tenant::"*"`         | WRITE_GUARD |
| PATCH  | `/v1/items/{id}`                                  | `mfg.item.update`                   | `Item::"<id>"`        | WRITE_GUARD |
| DELETE | `/v1/items/{id}`                                  | `mfg.item.delete`                   | `Item::"<id>"`        | WRITE_GUARD |
| POST   | `/v1/items/{id}/boms`                             | `mfg.bom.create`                    | `Item::"<id>"`        | WRITE_GUARD |
| POST   | `/v1/items/{id}/routings`                         | `mfg.routing.create`                | `Item::"<id>"`        | WRITE_GUARD |
| POST   | `/v1/work-centers`                                | `mfg.work_center.create`            | `Tenant::"*"`         | WRITE_GUARD |
| PATCH  | `/v1/work-centers/{id}`                           | `mfg.work_center.update`            | `WorkCenter::"<id>"`  | WRITE_GUARD |
| PATCH  | `/v1/boms/{id}`                                   | `mfg.bom.update`                    | `BOM::"<id>"`         | WRITE_GUARD |
| POST   | `/v1/boms/{id}/lines`                             | `mfg.bom.add_line`                  | `BOM::"<id>"`         | WRITE_GUARD |
| POST   | `/v1/boms/{id}/activate`                          | `mfg.bom.activate`                  | `BOM::"<id>"`         | WRITE_GUARD |
| PATCH  | `/v1/bom-lines/{id}`                              | `mfg.bom.update_line`               | `BOMLine::"<id>"`     | WRITE_GUARD |
| DELETE | `/v1/bom-lines/{id}`                              | `mfg.bom.delete_line`               | `BOMLine::"<id>"`     | WRITE_GUARD |
| PATCH  | `/v1/routings/{id}`                               | `mfg.routing.update`                | `Routing::"<id>"`     | WRITE_GUARD |
| POST   | `/v1/routings/{id}/operations`                    | `mfg.routing.add_operation`         | `Routing::"<id>"`     | WRITE_GUARD |
| PATCH  | `/v1/routing-operations/{id}`                     | `mfg.routing.update_operation`      | `RoutingOp::"<id>"`   | WRITE_GUARD |
| DELETE | `/v1/routing-operations/{id}`                     | `mfg.routing.delete_operation`      | `RoutingOp::"<id>"`   | WRITE_GUARD |
| POST   | `/v1/work-orders`                                 | `mfg.work_order.create`             | `Tenant::"*"`         | WRITE_GUARD |
| PATCH  | `/v1/work-orders/{id}`                            | `mfg.work_order.update`             | `WorkOrder::"<id>"`   | WRITE_GUARD |
| DELETE | `/v1/work-orders/{id}`                            | `mfg.work_order.delete`             | `WorkOrder::"<id>"`   | WRITE_GUARD |
| POST   | `/v1/work-orders/{id}/release`                    | `mfg.work_order.release`            | `WorkOrder::"<id>"`   | WRITE_GUARD |
| POST   | `/v1/lots`                                        | `mfg.lot.create`                    | `Tenant::"*"`         | WRITE_GUARD |
| PATCH  | `/v1/lots/{id}/status`                            | `mfg.lot.update_status`             | `Lot::"<id>"`         | WRITE_GUARD |
| POST   | `/v1/lots/{id}/genealogy`                         | `mfg.lot.add_genealogy`             | `Lot::"<id>"`         | WRITE_GUARD |
| POST   | `/v1/mrp/runs`                                    | `mfg.mrp.run`                       | `Tenant::"*"`         | WRITE_GUARD |
| GET    | `/v1/uoms`                                        | `mfg.uom.list`                      | `Tenant::"*"`         | READ_ONLY   |
| GET    | `/v1/uoms/{id}`                                   | `mfg.uom.read`                      | `UOM::"<id>"`         | READ_ONLY   |
| GET    | `/v1/items`                                       | `mfg.item.list`                     | `Tenant::"*"`         | READ_ONLY   |
| GET    | `/v1/items/{id}`                                  | `mfg.item.read`                     | `Item::"<id>"`        | READ_ONLY   |
| GET    | `/v1/items/{id}/boms`                             | `mfg.bom.list`                      | `Item::"<id>"`        | READ_ONLY   |
| GET    | `/v1/items/{id}/bom/explode`                      | `mfg.bom.explode`                   | `Item::"<id>"`        | READ_ONLY   |
| GET    | `/v1/items/{id}/lots`                             | `mfg.lot.list`                      | `Item::"<id>"`        | READ_ONLY   |
| GET    | `/v1/items/{id}/routings`                         | `mfg.routing.list`                  | `Item::"<id>"`        | READ_ONLY   |
| GET    | `/v1/work-centers`                                | `mfg.work_center.list`              | `Tenant::"*"`         | READ_ONLY   |
| GET    | `/v1/work-centers/{id}`                           | `mfg.work_center.read`              | `WorkCenter::"<id>"`  | READ_ONLY   |
| GET    | `/v1/boms/{id}`                                   | `mfg.bom.read`                      | `BOM::"<id>"`         | READ_ONLY   |
| GET    | `/v1/routings/{id}`                               | `mfg.routing.read`                  | `Routing::"<id>"`     | READ_ONLY   |
| GET    | `/v1/work-orders`                                 | `mfg.work_order.list`               | `Tenant::"*"`         | READ_ONLY   |
| GET    | `/v1/work-orders/{id}`                            | `mfg.work_order.read`               | `WorkOrder::"<id>"`   | READ_ONLY   |
| GET    | `/v1/work-orders/{id}/operations`                 | `mfg.work_order.list_operations`    | `WorkOrder::"<id>"`   | READ_ONLY   |
| GET    | `/v1/work-orders/{id}/materials`                  | `mfg.work_order.list_materials`     | `WorkOrder::"<id>"`   | READ_ONLY   |
| GET    | `/v1/lots/{id}/trace`                             | `mfg.lot.trace`                     | `Lot::"<id>"`         | READ_ONLY   |
| GET    | `/v1/mrp/runs`                                    | `mfg.mrp.list_runs`                 | `Tenant::"*"`         | READ_ONLY   |
| GET    | `/v1/mrp/runs/{id}`                               | `mfg.mrp.read_run`                  | `MRPRun::"<id>"`      | READ_ONLY   |
| GET    | `/v1/mrp/runs/{id}/demands`                       | `mfg.mrp.list_demands`              | `MRPRun::"<id>"`      | READ_ONLY   |
| GET    | `/v1/mrp/runs/{id}/supplies`                      | `mfg.mrp.list_supplies`             | `MRPRun::"<id>"`      | READ_ONLY   |
| GET    | `/v1/mrp/runs/{id}/actions`                       | `mfg.mrp.list_actions`              | `MRPRun::"<id>"`      | READ_ONLY   |

### quality-svc (`services/quality-svc`)

Route base: `/v1`.

| Method | Path                                          | Action                              | Resource                  | Guard       |
| ------ | --------------------------------------------- | ----------------------------------- | ------------------------- | ----------- |
| POST   | `/v1/apqp`                                    | `quality.apqp.create`               | `Tenant::"*"`             | WRITE_GUARD |
| PATCH  | `/v1/apqp/{id}`                               | `quality.apqp.update`               | `APQP::"<id>"`            | WRITE_GUARD |
| DELETE | `/v1/apqp/{id}`                               | `quality.apqp.delete`               | `APQP::"<id>"`            | WRITE_GUARD |
| POST   | `/v1/ppap`                                    | `quality.ppap.create`               | `Tenant::"*"`             | WRITE_GUARD |
| PATCH  | `/v1/ppap/{id}`                               | `quality.ppap.update`               | `PPAP::"<id>"`            | WRITE_GUARD |
| DELETE | `/v1/ppap/{id}`                               | `quality.ppap.delete`               | `PPAP::"<id>"`            | WRITE_GUARD |
| PATCH  | `/v1/ppap-elements/{id}`                      | `quality.ppap.update_element`       | `PPAPElement::"<id>"`     | WRITE_GUARD |
| POST   | `/v1/fmea`                                    | `quality.fmea.create`               | `Tenant::"*"`             | WRITE_GUARD |
| PATCH  | `/v1/fmea/{id}`                               | `quality.fmea.update`               | `FMEA::"<id>"`            | WRITE_GUARD |
| DELETE | `/v1/fmea/{id}`                               | `quality.fmea.delete`               | `FMEA::"<id>"`            | WRITE_GUARD |
| POST   | `/v1/fmea/{id}/modes`                         | `quality.fmea.add_mode`             | `FMEA::"<id>"`            | WRITE_GUARD |
| PATCH  | `/v1/fmea-modes/{id}`                         | `quality.fmea.update_mode`          | `FMEAMode::"<id>"`        | WRITE_GUARD |
| DELETE | `/v1/fmea-modes/{id}`                         | `quality.fmea.delete_mode`          | `FMEAMode::"<id>"`        | WRITE_GUARD |
| POST   | `/v1/control-plans`                           | `quality.control_plan.create`       | `Tenant::"*"`             | WRITE_GUARD |
| PATCH  | `/v1/control-plans/{id}`                      | `quality.control_plan.update`       | `ControlPlan::"<id>"`     | WRITE_GUARD |
| POST   | `/v1/control-plans/{id}/characteristics`      | `quality.control_plan.add_characteristic` | `ControlPlan::"<id>"` | WRITE_GUARD |
| PATCH  | `/v1/control-plan-chars/{id}`                 | `quality.control_plan.update_characteristic` | `ControlPlanChar::"<id>"` | WRITE_GUARD |
| DELETE | `/v1/control-plan-chars/{id}`                 | `quality.control_plan.delete_characteristic` | `ControlPlanChar::"<id>"` | WRITE_GUARD |
| POST   | `/v1/inspections`                             | `quality.inspection.create`         | `Tenant::"*"`             | WRITE_GUARD |
| POST   | `/v1/ncrs`                                    | `quality.ncr.create`                | `Tenant::"*"`             | WRITE_GUARD |
| PATCH  | `/v1/ncrs/{id}`                               | `quality.ncr.update`                | `NCR::"<id>"`             | WRITE_GUARD |
| POST   | `/v1/ncrs/{id}/capa`                          | `quality.ncr.create_capa`           | `NCR::"<id>"`             | WRITE_GUARD |
| PATCH  | `/v1/capa/{id}`                               | `quality.capa.update`               | `CAPA::"<id>"`            | WRITE_GUARD |
| GET    | `/v1/apqp`                                    | `quality.apqp.list`                 | `Tenant::"*"`             | READ_ONLY   |
| GET    | `/v1/apqp/{id}`                               | `quality.apqp.read`                 | `APQP::"<id>"`            | READ_ONLY   |
| GET    | `/v1/ppap`                                    | `quality.ppap.list`                 | `Tenant::"*"`             | READ_ONLY   |
| GET    | `/v1/ppap/{id}`                               | `quality.ppap.read`                 | `PPAP::"<id>"`            | READ_ONLY   |
| GET    | `/v1/ppap/{id}/elements`                      | `quality.ppap.list_elements`        | `PPAP::"<id>"`            | READ_ONLY   |
| GET    | `/v1/fmea`                                    | `quality.fmea.list`                 | `Tenant::"*"`             | READ_ONLY   |
| GET    | `/v1/fmea/{id}`                               | `quality.fmea.read`                 | `FMEA::"<id>"`            | READ_ONLY   |
| GET    | `/v1/fmea/{id}/modes`                         | `quality.fmea.list_modes`           | `FMEA::"<id>"`            | READ_ONLY   |
| GET    | `/v1/control-plans`                           | `quality.control_plan.list`         | `Tenant::"*"`             | READ_ONLY   |
| GET    | `/v1/control-plans/{id}`                      | `quality.control_plan.read`         | `ControlPlan::"<id>"`     | READ_ONLY   |
| GET    | `/v1/control-plans/{id}/characteristics`      | `quality.control_plan.list_characteristics` | `ControlPlan::"<id>"` | READ_ONLY   |
| GET    | `/v1/inspections`                             | `quality.inspection.list`           | `Tenant::"*"`             | READ_ONLY   |
| GET    | `/v1/inspections/{id}`                        | `quality.inspection.read`           | `Inspection::"<id>"`      | READ_ONLY   |
| GET    | `/v1/ncrs`                                    | `quality.ncr.list`                  | `Tenant::"*"`             | READ_ONLY   |
| GET    | `/v1/ncrs/{id}`                               | `quality.ncr.read`                  | `NCR::"<id>"`             | READ_ONLY   |
| GET    | `/v1/ncrs/{id}/capa`                          | `quality.ncr.list_capa`             | `NCR::"<id>"`             | READ_ONLY   |

> `quality.ncr.close` (state-transition action mentioned in the plan
> narrative) is materialised as `quality.ncr.update` today because the
> close transition is performed via PATCH `/v1/ncrs/{id}`. A dedicated
> `POST /v1/ncrs/{id}/close` endpoint may be added in a future plan; if so
> it gets its own `quality.ncr.close` action row.

### workflow-svc (`services/workflow-svc`)

Route base: `/v1`.

| Method | Path                                       | Action                              | Resource                  | Guard       |
| ------ | ------------------------------------------ | ----------------------------------- | ------------------------- | ----------- |
| POST   | `/v1/workflows`                            | `workflow.create`                   | `Tenant::"*"`             | WRITE_GUARD |
| PATCH  | `/v1/workflows/{id}`                       | `workflow.update`                   | `Workflow::"<id>"`        | WRITE_GUARD |
| DELETE | `/v1/workflows/{id}`                       | `workflow.delete`                   | `Workflow::"<id>"`        | WRITE_GUARD |
| POST   | `/v1/workflows/{id}/versions`              | `workflow.version.create`           | `Workflow::"<id>"`        | WRITE_GUARD |
| POST   | `/v1/workflows/{id}/publish`               | `workflow.publish`                  | `Workflow::"<id>"`        | WRITE_GUARD |
| POST   | `/v1/workflows/{id}/start`                 | `workflow.instance.start`           | `Workflow::"<id>"`        | WRITE_GUARD |
| POST   | `/v1/instances/{id}/resume`                | `workflow.instance.resume`          | `Instance::"<id>"`        | WRITE_GUARD |
| POST   | `/v1/instances/{id}/cancel`                | `workflow.instance.cancel`          | `Instance::"<id>"`        | WRITE_GUARD |
| POST   | `/v1/human-tasks/{id}/complete`            | `workflow.human_task.complete`      | `HumanTask::"<id>"`       | WRITE_GUARD |
| GET    | `/v1/workflows`                            | `workflow.list`                     | `Tenant::"*"`             | READ_ONLY   |
| GET    | `/v1/workflows/{id}`                       | `workflow.read`                     | `Workflow::"<id>"`        | READ_ONLY   |
| GET    | `/v1/workflows/{id}/versions`              | `workflow.version.list`             | `Workflow::"<id>"`        | READ_ONLY   |
| GET    | `/v1/workflow-versions/{id}`               | `workflow.version.read`             | `WorkflowVersion::"<id>"` | READ_ONLY   |
| GET    | `/v1/workflows/{id}/instances`             | `workflow.instance.list`            | `Workflow::"<id>"`        | READ_ONLY   |
| GET    | `/v1/instances/{id}`                       | `workflow.instance.read`            | `Instance::"<id>"`        | READ_ONLY   |
| GET    | `/v1/human-tasks`                          | `workflow.human_task.list`          | `Tenant::"*"`             | READ_ONLY   |
| GET    | `/v1/instances/{id}/human-tasks`           | `workflow.human_task.list`          | `Instance::"<id>"`        | READ_ONLY   |

### reports-svc (`services/reports-svc`)

Route base: `/v1`.

| Method | Path                              | Action                  | Resource             | Guard       |
| ------ | --------------------------------- | ----------------------- | -------------------- | ----------- |
| POST   | `/v1/dashboards`                  | `report.dashboard.create` | `Tenant::"*"`      | WRITE_GUARD |
| PATCH  | `/v1/dashboards/{id}`             | `report.dashboard.update` | `Dashboard::"<id>"`| WRITE_GUARD |
| DELETE | `/v1/dashboards/{id}`             | `report.dashboard.delete` | `Dashboard::"<id>"`| WRITE_GUARD |
| GET    | `/v1/dashboards`                  | `report.dashboard.list`   | `Tenant::"*"`      | READ_ONLY   |
| GET    | `/v1/dashboards/{id}`             | `report.dashboard.read`   | `Dashboard::"<id>"`| READ_ONLY   |
| GET    | `/v1/metrics/summary`             | `report.metric.summary`   | `Tenant::"*"`      | READ_ONLY   |
| GET    | `/v1/metrics/timeseries`          | `report.metric.timeseries`| `Tenant::"*"`      | READ_ONLY   |
| GET    | `/v1/metrics/by-status`           | `report.metric.by_status` | `Tenant::"*"`      | READ_ONLY   |

> Existing `dashboard.create / update / delete / read` actions in
> `bundle.cedar` will be renamed to the `report.dashboard.*` form during
> Plan #4 Task 3 so action names are uniformly service-prefixed.

### audit-svc (`services/audit-svc`)

Route base: `/v1`.

| Method | Path                  | Action          | Resource           | Guard      |
| ------ | --------------------- | --------------- | ------------------ | ---------- |
| GET    | `/v1/audit`           | `audit.list`    | `Tenant::"*"`      | READ_ONLY  |
| GET    | `/v1/audit/buckets`   | `audit.buckets` | `Tenant::"*"`      | READ_ONLY  |
| GET    | `/v1/audit/{id}`      | `audit.read`    | `AuditEvent::"<id>"` | READ_ONLY |

> audit-svc is read-only by design — writes flow in through NATS via
> audit-worker, never through HTTP. No `WRITE_GUARD` rows.

### identity-svc (`services/identity-svc`) — out of scope for Plan #4 wiring

Documented here for completeness; identity-svc already uses Cedar for
`jwt.rotate` via `policy.Decide` (Plan #2). Plan #4 may add a
`tenant.user.invite` endpoint; if so it gets a new row.

| Method | Path                                          | Action                   | Resource         | Guard       |
| ------ | --------------------------------------------- | ------------------------ | ---------------- | ----------- |
| POST   | `/v1/login`                                   | `auth.login`             | `Tenant::"*"`    | unguarded (public) |
| POST   | `/v1/admin/keys/rotate`                       | `jwt.rotate`             | `Tenant::"*"`    | WRITE_GUARD (already enforced) |
| GET    | `/.well-known/jwks.json`                      | n/a                      | n/a              | unguarded (public) |
| POST   | `/v1/admin/sso/configs`                       | `tenant.sso.configure`   | `Tenant::"*"`    | WRITE_GUARD (Plan #6 Task 5) |
| PATCH  | `/v1/admin/sso/configs/{id}`                  | `tenant.sso.configure`   | `Tenant::"*"`    | WRITE_GUARD (Plan #6 Task 5) |
| DELETE | `/v1/admin/sso/configs/{id}`                  | `tenant.sso.configure`   | `Tenant::"*"`    | WRITE_GUARD (Plan #6 Task 5) |
| GET    | `/v1/admin/sso/configs`                       | `tenant.sso.configure`   | `Tenant::"*"`    | WRITE_GUARD (Plan #6 Task 5) |
| GET    | `/v1/auth/oidc/{tenant_slug}/start`           | n/a                      | n/a              | unguarded (public; signed-state JWT is the credential) |
| GET    | `/v1/auth/oidc/{tenant_slug}/callback`        | n/a                      | n/a              | unguarded (public; IdP ID-token is the credential) |

## Notes

- This ADR is referenced from Plan #2 self-review (see
  `docs/superpowers/plans/2026-05-17-plan-02-identity-tenant.md` §
  Self-review) as the binding registry of Cedar actions for downstream
  service wiring.
- When Plan #4 adds the `tenant.user.invite` endpoint to identity-svc or
  tenant-svc, append a row to the relevant section rather than creating a
  new ADR.
- Plan #6 (read-side ABAC) will revisit the `READ_ONLY` rows; until then
  reads rely on `auth.Require` JWT validation plus tenant-scoped RLS in
  Postgres.

## Update — Plan #6 Task 6 (2026-05-22)

Per-instance ABAC landed via `RequireActionScoped` (see ADR-0003). The `Guard` column in the matrices above is now effectively superseded for write endpoints with id params — the live `<Entity>::{:id}` template at the middleware level passes the resource through to Cedar, which evaluates ABAC rules in `libs/policy/bundle.cedar`. Create endpoints (no id in URL) continue to use `RequireAction(..., "*")`; ABAC for create gates by `context.tenant_id` only.

The authoritative resource template per service is in:

- `services/tenant-svc/internal/api/handlers.go`
- `services/project-svc/internal/api/handlers.go`
- `services/document-svc/internal/api/handlers.go`
- `services/mfg-svc/internal/api/handlers.go`
- `services/quality-svc/internal/api/handlers.go`
- `services/workflow-svc/internal/api/handlers.go`
- `services/reports-svc/internal/api/handlers.go`

Read endpoints are governed by the same ABAC `forbid` rules even though they only use `auth.Require` at the middleware level — Cedar evaluates resource attributes loaded by the per-service `cedar_loader.go`.
