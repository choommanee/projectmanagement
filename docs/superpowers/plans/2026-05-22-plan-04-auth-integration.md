# Plan #4 — Auth Integration (Cedar enforcement across product services) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Cedar policy engine — proved out on `identity-svc` in commit `3bac041` (`POST /v1/admin/keys/rotate` gated by `auth.RequireAction("jwt.rotate", "*")`) — into every product service so authorization is policy-driven instead of ad-hoc. Closes the "real auth wiring (will land when project-svc + identity-svc are wired together in Plan #4 / #6)" deferral from Plan #3 self-review (line 2724).

**Architecture:** Each service's HTTP middleware stack picks up a shared `Authorizer` built from a Cedar bundle (currently `services/identity-svc/internal/policy/bundle.cedar`, promoted to a shared location in Task 2). Endpoints declare `auth.RequireAction("<service>.<action>", "<resource>")` per route. The `policy.Adapter` already lives in `services/identity-svc/internal/policy/bundle.go` — it is moved up the dependency tree so other services can import it without depending on identity-svc internals. Read endpoints stay behind `auth.Require` (authentication only) for now; only write/destructive endpoints get `RequireAction`. Read-side policy coverage is deferred to Plan #6.

**Tech stack:** Reuse `cedar-policy/cedar-go`, `libs/go/auth` (`Require`, `RequireAction`, `WithClaims`, `Authorizer`), `services/identity-svc/internal/policy` (to be promoted). No new runtime dependencies.

**Prerequisites:** Plan #2 (DONE — commit `1c59d4d` JWT rotation engine, `3bac041` Cedar gate + scheduler). Plan #3 (DONE — UI Shell shipped). Recommended but not strictly required: Plan #5 (PM UI advanced) so that the new 403 responses can be surfaced in the UI; this plan only ensures the backend rejects unauthorized calls.

---

## File Structure

```
docs/
└── adr/
    └── 0002-cedar-actions.md             # (new) canonical action × resource matrix

libs/
├── go/auth/                              # existing — Authorizer + RequireAction lives here
└── policy/                               # (new) shared bundle + LoadShared() helper
    ├── go.mod
    ├── bundle.cedar                      # moved from services/identity-svc/internal/policy
    ├── bundle.go                         # exposes LoadShared(), Adapter
    └── bundle_test.go

services/
├── identity-svc/internal/policy/         # bundle.cedar removed; cedar.go stays
├── tenant-svc/cmd/server/main.go         # injects authz into router
├── tenant-svc/internal/api/handlers.go   # RequireAction on write endpoints
├── project-svc/...                       # same pattern
├── document-svc/...
├── mfg-svc/...
├── quality-svc/...
├── workflow-svc/...
├── reports-svc/...
└── audit-svc/...

infra/migrations/identity/
└── 00007_policy_bundle.sql               # (new) policy_bundle table for runtime edits

tools/scripts/
└── smoke-authz.sh                        # (new) end-to-end allow/deny grid
```

---

## Task 1: Define the canonical action × resource matrix

**Files:**
- Create: `docs/adr/0002-cedar-actions.md`

- [ ] **Step 1: Inventory every write endpoint across product services**

Run `grep -rn "router.Post\|router.Put\|router.Patch\|router.Delete" services/*/internal/api/` and collect (service, method, path, current auth guard).

- [ ] **Step 2: Pick action names**

Convention: `<service>.<entity>.<verb>` — e.g. `project.task.create`, `mfg.work_order.release`, `quality.ncr.close`, `tenant.user.invite`. Resources are typed as `<Entity>::"<id-or-*>"` Cedar entity refs — e.g. `Project::"<uuid>"`, `Tenant::"*"`.

- [ ] **Step 3: Write the ADR**

`docs/adr/0002-cedar-actions.md` lists every (service, route, action, resource) tuple as a Markdown table. Mark each row as `WRITE_GUARD` (must use `RequireAction` in Plan #4) or `READ_ONLY` (deferred to Plan #6 — `auth.Require` only). Link this ADR from Plan #2 self-review note.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0002-cedar-actions.md
git commit -m "docs(adr): 0002 — Cedar action × resource matrix"
```

---

## Task 2: Promote the policy bundle to a shared lib

**Files:**
- Create: `libs/policy/go.mod`
- Create: `libs/policy/bundle.go` (moved + extended from `services/identity-svc/internal/policy/bundle.go`)
- Move: `services/identity-svc/internal/policy/bundle.cedar` → `libs/policy/bundle.cedar`
- Modify: `services/identity-svc/internal/policy/bundle.go` to delegate to `libs/policy`
- Modify: `go.work` to add `./libs/policy`

- [ ] **Step 1: Create lib + move bundle.cedar**

```bash
mkdir -p libs/policy
git mv services/identity-svc/internal/policy/bundle.cedar libs/policy/bundle.cedar
```

- [ ] **Step 2: Write `libs/policy/bundle.go`**

Expose `LoadShared() (*cedar.PolicySet, error)` that reads the embedded `bundle.cedar`, splits on `permit;`/`forbid;` per the existing identity-svc implementation, and returns a `*cedar.PolicySet`. Re-export `Adapter` here so any service can build a `libauth.Authorizer` with `&policy.Adapter{Policies: ps}`.

- [ ] **Step 3: Shrink identity-svc/internal/policy/bundle.go**

Keep only what identity-svc still needs (if anything). The `cmd/server/main.go` should now call `policy.LoadShared()` (from `libs/policy`) instead of the in-service bundle loader.

- [ ] **Step 4: Add to go.work + smoke**

```bash
go work use ./libs/policy
go build ./...
go test ./libs/policy/...
go test ./services/identity-svc/...
```

- [ ] **Step 5: Commit**

```bash
git add libs/policy services/identity-svc/internal/policy go.work go.work.sum
git commit -m "refactor(policy): promote Cedar bundle to libs/policy (Plan #4 Task 2)"
```

---

## Task 3: Wire `RequireAction` into each product service

**Pattern — one task block per service.** The pattern is identical:

1. In `cmd/server/main.go`, after creating the JWT verifier and tenant middleware, build `authz := &policy.Adapter{Policies: ps}` (where `ps` came from `policy.LoadShared()`).
2. Pass `authz` into the router constructor (`api.NewRouter(..., authz)`).
3. In `internal/api/handlers.go` (or split routers), wrap each write route with `r.With(libauth.RequireAction(authz, "<service>.<action>", "<resource>"))` — referring to the matrix in ADR-0002.
4. Update existing handler tests to pass either a real `policy.Adapter` (loading the bundle) or a stub `libauth.Authorizer` that returns allow/deny per case.

Apply this pattern in order:

- [ ] **Step 1: tenant-svc** — actions: `tenant.create`, `tenant.update`, `tenant.archive`, `tenant.user.invite`. Files: `services/tenant-svc/cmd/server/main.go`, `internal/api/handlers.go`, `internal/api/handlers_test.go`.

- [ ] **Step 2: project-svc** — actions: `project.create`, `project.update`, `project.delete`, `project.task.create`, `project.task.update`, `project.task.delete`, `project.sprint.create`, `project.sprint.close`. Files: `services/project-svc/...`.

- [ ] **Step 3: document-svc** — actions: `document.workspace.create`, `document.create`, `document.update`, `document.delete`, `document.version.create`, `document.comment.create`. Files: `services/document-svc/...`. (Storage-related write endpoints from the parked Wave 4C stash are out of scope here; they re-enter via Plan #7.)

- [ ] **Step 4: mfg-svc** — actions: `mfg.item.create`, `mfg.uom.create`, `mfg.bom.create`, `mfg.bom.update`, `mfg.routing.create`, `mfg.work_order.create`, `mfg.work_order.release`, `mfg.work_order.close`, `mfg.mrp.run`. Files: `services/mfg-svc/...`.

- [ ] **Step 5: quality-svc** — actions: `quality.apqp.create`, `quality.ppap.submit`, `quality.fmea.create`, `quality.control_plan.publish`, `quality.inspection.record`, `quality.ncr.open`, `quality.ncr.close`, `quality.capa.close`. Files: `services/quality-svc/...`.

- [ ] **Step 6: workflow-svc** — actions: `workflow.definition.create`, `workflow.definition.publish`, `workflow.definition.delete`, `workflow.instance.start`, `workflow.instance.cancel`, `workflow.human_task.complete`. Files: `services/workflow-svc/...`. (Note: the workflow NATS trigger consumer is parked in the Wave 4D stash; it does not gain authz checks here because its caller is the platform itself, not a user.)

- [ ] **Step 7: reports-svc** — actions: `reports.dashboard.create`, `reports.dashboard.update`, `reports.dashboard.delete`, `reports.dashboard.publish`. Files: `services/reports-svc/...`.

- [ ] **Step 8: audit-svc** — actions: `audit.export`, `audit.purge`. Read endpoints stay behind `auth.Require` only. Files: `services/audit-svc/...`.

After each step: `go test ./services/<svc>/...` (real Postgres, no mocks). Commit per service.

---

## Task 4: Author the policies in `libs/policy/bundle.cedar`

**Files:**
- Modify: `libs/policy/bundle.cedar`
- Modify: `libs/policy/bundle_test.go`

- [ ] **Step 1: Cover the write-guard rows from ADR-0002**

For each action in the matrix, add a `permit` rule. Default convention: `permit when context.roles.contains("<role>")` where role is one of `platform-admin`, `tenant-admin`, `project-manager`, `mfg-operator`, `quality-engineer`, `workflow-author`, `bi-author`. Use Cedar `Set` operations consistently with the existing `roles` envelope built by `services/identity-svc/internal/policy/cedar.go::buildContext`.

- [ ] **Step 2: Add `forbid` rules for destructive actions**

`forbid` overrides `permit` in Cedar; use it for `tenant.delete`, `project.delete`, `workflow.definition.delete`, `mfg.lot.recall`, `audit.purge` — only allow if role is explicitly `platform-admin` AND the request carries an additional `confirm_destructive: true` header (carried through the Cedar `context` envelope — small `auth.RequireAction` extension may be needed).

- [ ] **Step 3: Expand `bundle_test.go`**

Table-driven: one row per (action, role, expected allow/deny). Run with `go test ./libs/policy/...`.

- [ ] **Step 4: Commit**

```bash
git add libs/policy/bundle.cedar libs/policy/bundle_test.go
git commit -m "feat(policy): populate Cedar bundle for product write-guards"
```

---

## Task 5: Per-service real-Postgres allow / deny smoke tests

For each service touched in Task 3, add **one** integration test that asserts:
- A request with the right role passes (200/201).
- A request with no role gets 403.

The pattern is already established in `services/identity-svc/internal/api/cedar_rotate_test.go` — copy it. Real-Postgres on `:5432` (per project memory). Skip-with-message if Postgres unreachable.

- [ ] **Step 1–8 (one step per service):** `cedar_<entity>_test.go` in each service's `internal/api/` dir.

- [ ] **Step 9: Run all and confirm green**

```bash
go test ./services/...
```

- [ ] **Step 10: Commit** (one commit per service is fine; or one rollup commit if diffs are small)

---

## Task 6: Persistent `policy_bundle` table (delegated to db-migration-steward)

**Files:**
- Create: `infra/migrations/identity/00007_policy_bundle.sql`

- [ ] **Step 1: Schema**

```sql
-- +goose Up
CREATE TABLE policy_bundle (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    body        TEXT NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID NULL
);
CREATE UNIQUE INDEX policy_bundle_active_idx ON policy_bundle (active) WHERE active;
```

- [ ] **Step 2: `libs/policy/bundle.go` learns to load from DB when `POLICY_SOURCE=db`**

Default remains the embedded file (`POLICY_SOURCE=embed`, the current behavior). Add `LoadFromDB(ctx, pool)` and document the env switch.

- [ ] **Step 3: Identity-svc gains `POST /v1/admin/policy/reload`** that reads the active bundle row, rebuilds the engine, and atomically swaps via an `atomic.Pointer` similar to the JWT signer pattern. Gate it with `auth.RequireAction("policy.reload", "*")`.

- [ ] **Step 4: Tests + commit.**

---

## Task 7: Smoke script

**Files:**
- Create: `tools/scripts/smoke-authz.sh`

- [ ] **Step 1: Script outline**

Bash with `set -euo pipefail`. Reads `IDENTITY_URL`, per-service URLs, a known platform-admin and a known regular-user credential pair. For every row in the ADR-0002 matrix:
- Mint two tokens (admin, user).
- Hit the endpoint with each.
- Assert 200/201 for the role-matching token and 403 for the other.

- [ ] **Step 2: Color output + per-step `[N/M]` progress, like `smoke-identity` patterns.**

- [ ] **Step 3: Commit + smoke run** (services up locally; if any unreachable, script reports cleanly and exits non-zero).

---

## Self-review

- ADR-0002 is the single source of truth for action × resource. Drift between code and ADR is a review-blocking issue.
- Read endpoints intentionally still use only `auth.Require` (authentication). Real read-side scoping (e.g. "user can only see projects in their org") lands in **Plan #6 — Real auth wiring continuation (read-side scoping + refresh-token rotation + MFA + password reset + OIDC federation)**.
- Cedar policy bundle stays embedded by default; the DB-backed loader is opt-in (`POLICY_SOURCE=db`) so the dev path remains "edit file, restart service".
- Stashed work from this session's Wave 4B/4C/4D maps to: notif-svc → **Plan #7 — Notifications + multi-channel delivery**; MinIO + document storage → **Plan #8 — Document storage + presigned URLs**; workflow NATS trigger consumer → **Plan #9 — Workflow trigger types (event/schedule/webhook/form)**.
- PM UI advanced (Gantt + Kanban + advanced filter chip builder + collaborative editing) remains **Plan #5**, independent of this plan.
- Pre-existing user WIP under `libs/go/*/go.{mod,sum}`, `services/{tenant-svc,audit-worker}/go.{mod,sum}`, and `tools/scripts/{migrate,seed-demo}.sh` is NOT touched by this plan and must be committed (or discarded) on a separate branch by the user before Task 3 starts — otherwise Cedar wiring commits will entangle with the user's pending Go module updates.
- No placeholders. Every code step contains executable content.
