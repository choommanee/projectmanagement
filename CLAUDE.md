# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Polyglot monorepo for a multi-tenant PM + Manufacturing SaaS (MS Dynamics 365-style UX). Phase 1 anchors on Manufacturing as the primary vertical, augmented by PM Core + Role Workspaces (PM/BA/SA/Expert) and a Workflow Automation engine.

- Go workspace (`go.work`) → services + shared libs
- Cargo workspace (root `Cargo.toml`) → compute-heavy engines + shared Rust libs
- pnpm workspace + Turborepo (`pnpm-workspace.yaml`, `turbo.json`) → Next.js web + design tokens + ui-kit
- Postgres 16 (RLS for multi-tenancy), Redis, NATS JetStream, ClickHouse, MinIO/S3, Meilisearch

## Local dev — native, not docker

**Postgres runs natively on `localhost:5432` (`app/app/platform`).** Do NOT run `docker compose up` or `tools/scripts/dev-up.sh` unless explicitly asked — those exist for new-joiner reference but the daemon is typically off on this machine. The compose file maps Postgres to `:5433`, which is irrelevant for the live workflow. Other services (NATS, Redis, ClickHouse, MinIO) are similarly native or skipped.

Default service ports: tenant `8081`, identity `8082`, project `8083`, document `8084`, mfg `8085`, mrp-engine `8086`, quality `8087`, traceability-engine `8088`, audit-svc `8089`, workflow-svc `8090`, audit-worker `8091`, reports-svc `8092`.

## Commands

```bash
# Frontend (apps/web on :3000)
pnpm install                                  # one-time at repo root
pnpm --filter web dev                         # Next.js dev server
pnpm --filter web build                       # production build (includes typecheck)
pnpm --filter web test                        # vitest
pnpm --filter @pmplatform/ui-kit test         # ui-kit primitives
pnpm --filter @pmplatform/ui-kit test -- Select.test.tsx  # single test file
pnpm build / pnpm lint / pnpm typecheck       # via turbo across all TS packages

# Go services (per module — go.work resolves shared libs)
cd services/<svc> && go run ./cmd/server      # boot a service
cd services/<svc> && go test ./...            # all tests in module
cd services/<svc> && go test -run TestName ./internal/api/...  # single test
cd services/<svc> && go build ./...           # compile

# Rust engines
cargo run -p <engine-name>                    # e.g. mrp-engine, traceability-engine
cargo test -p <crate>                         # tests for one crate
cargo clippy --all-targets -- -D warnings    # lint

# Migrations (Goose, per-service dirs under infra/migrations/<svc>/)
tools/scripts/migrate.sh up                   # all services
tools/scripts/migrate.sh up identity          # one service
tools/scripts/migrate.sh down identity        # rollback one step

# End-to-end smoke
tools/scripts/smoke-authz.sh                  # Cedar allow/deny grid across services
```

## Architecture

### Service layout (Go, `services/<name>/`)

Every Go service follows the same shape (template: `services/_template/`):

```
cmd/server/main.go          # boot wiring
internal/
  domain/                   # entities + business rules (pure)
  store/                    # postgres repository (pgx)
  service/                  # use cases
  api/                      # chi handlers + middleware
```

Shared Go libs live in `libs/go/`:
- `auth` — JWT verify (`Require`), tenant header (`TenantHeader`), Cedar authorization (`RequireAction(authz, action, resource)`), `WithClaims` helper for tests
- `db` — pgx wrapper with the RLS helper (`db.WithTenant(ctx, tenantID)` sets `app.current_tenant`)
- `httpx` — chi server + middleware stack (request id, logger, recoverer)
- `logger` — zap setup
- `nats` — JetStream client
- `otel` — tracing setup
- `audit` — audit event publishing with NATS + PG dual-write fallback
- `policy` lives at top-level `libs/policy/` (NOT under `libs/go/`) — Cedar policy bundle loader (`LoadShared()` / `LoadFromDB()`) and `DynamicAdapter` (atomic.Pointer-backed Cedar engine swap for runtime policy reloads)

Rust engines live in `engines/<name>/` (template: `engines/_template/`). They are sync HTTP compute kernels called by their owning Go service; business orchestration stays in Go. Shared Rust libs at `libs/rust/{obs,db}`.

### Multi-tenancy

Every tenant-scoped table has `tenant_id uuid NOT NULL` + `ENABLE ROW LEVEL SECURITY` + a `USING (tenant_id = current_tenant_uuid())` policy. The session variable is named **`app.current_tenant`** in code, migrations, and policies (early spec drafts called it `app.tenant_id` — that name is dead). Middleware sets it via `SET LOCAL app.current_tenant = '<uuid>'` before each query batch. Never bypass RLS for "convenience".

### Authorization (Cedar)

`libs/policy/bundle.cedar` is the canonical policy source. Every product service builds:

```go
ps, _ := libpolicy.LoadShared()                     // embed (default) or DB (POLICY_SOURCE=db)
authz := libpolicy.NewDynamicAdapter(ps)            // atomic-swappable
api.NewRouter(svc, authz)                           // injected into middleware chain
```

Then each write endpoint declares its action:

```go
r.With(libauth.RequireAction(authz, "mfg.work_order.release", "*")).
    Post("/v1/work-orders/{id}/release", ...)
```

The canonical action × resource matrix is **`docs/adr/0002-cedar-actions.md`** — that ADR lists every (service, route, action, resource, guard) tuple. When adding a new endpoint, add a row there first, then a `permit` in `libs/policy/bundle.cedar`, then wrap the route. Roles: `platform-admin`, `tenant-admin`, `project-manager`, `mfg-operator`, `quality-engineer`, `workflow-author`, `bi-author`.

Destructive actions (`tenant.delete`, `project.delete`, `workflow.delete`, `mfg.work_order.delete`) require `platform-admin` AND the `X-Confirm-Destructive: true` request header (propagated into Cedar context by `libs/go/auth/authz.go`).

Identity-svc exposes `POST /v1/admin/policy/reload` (gated by `policy.reload` action) that swaps the active bundle without restart when `POLICY_SOURCE=db`.

### JWT signing

`services/identity-svc/internal/jwt/` runs an atomic-swappable signer (`DynamicSigner`). `Store.Rotate(ctx, newKid)` atomically inserts a new active key and marks the previous one superseded; tokens minted after the call use the new kid immediately. `JWKS()` publishes the active key plus any rotated keys still inside the grace window (`jwksMaxAge`, default 24h) so consumers verifying tokens signed shortly before rotation don't fail. `POST /v1/admin/keys/rotate` is the admin trigger; `JWT_ROTATION_INTERVAL>0` starts an auto-rotation goroutine.

### Frontend (`apps/web/`)

Next.js 15 App Router. The shell is under `(shell)/` with per-app layouts at `(shell)/[app]/`. Schema-driven primitives (`FormRenderer`, `ListView`, `DashboardGrid`) in `packages/ui-kit/src/` render arbitrary entities from JSON config — avoid hand-baking layouts when a schema would do.

i18n via `next-intl` (no-routing pattern): `middleware.ts` strips `/th` and `/en` locale prefixes and sets a `NEXT_LOCALE` cookie; `apps/web/messages/{en,th}.json` hold strings. Shell chrome already uses `useTranslations('shell')`; product pages still hardcode EN (migration is a future plan).

Theme: industrial-instrument visual vocabulary (dense type, instrument-panel borders, mono numerals via `JetBrains_Mono` for metrics, `Inter` for prose). Tokens in `packages/design-tokens/` — never hardcode colors/spacing/radii in components.

## Testing convention

**Real Postgres on `:5432` for store + handler tests — no DB mocks.** This is a hard project rule from a past production incident where mocked migrations passed but real ones failed. If `localhost:5432` is unreachable in CI, tests skip with a clear message rather than mock the DB.

Cedar smoke tests follow the pattern in `services/<svc>/internal/api/cedar_*_test.go`: load the real bundle via `libpolicy.LoadShared()`, mint a JWT via the live identity-svc store, inject claims via `libauth.WithClaims`, assert allow (200/201) for the right role and deny (403) for the wrong role.

## Plan-driven workflow

Multi-step work is captured in numbered plans under `docs/superpowers/plans/` (e.g. `2026-05-22-plan-04-auth-integration.md`). Each plan has Tasks 1..N with `- [ ]` checkbox steps so it can be executed via the `superpowers:subagent-driven-development` or `superpowers:executing-plans` skill. Each plan's `## Self-review` section lists deferred items and forward-references future plans by number (e.g. "real auth wiring lands in Plan #4/#6").

When starting non-trivial work, first check whether an open plan covers it. If it spans modules not yet planned, author a new plan in `docs/superpowers/plans/` before executing.

Specialist subagents under `.claude/agents/` (`frontend-ui-engineer`, `go-service-engineer`, `rust-engine-engineer`, `db-migration-steward`, `integration-tester`, `devops-infra`, `qa-reviewer`, `plan-coordinator`) carry the project conventions inline so dispatch prompts can stay short.

## Migration discipline

Goose format under `infra/migrations/<service>/NNNNN_name.sql`. Both `-- +goose Up` and `-- +goose Down` are required, and Down MUST cleanly reverse. Every tenant-scoped table additionally gets:

- `tenant_id uuid NOT NULL` + FK to `tenant(id) ON DELETE CASCADE`
- `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY ... USING (tenant_id = current_tenant_uuid())`
- A `(tenant_id, ...)` index for hot-path lookups

`tools/scripts/migrate.sh` orchestrates per-service version tables — never bypass it with raw `goose up` from a service dir.

## What not to do

- No `docker compose up` unless explicitly asked.
- No DB mocks in tests.
- No hardcoded colors / spacing / strings in `apps/web/` — use tokens + locale files.
- No new shared libs before checking `libs/go/`, `libs/rust/`, `libs/policy/`, and `packages/`.
- No destructive git operations (`git reset --hard`, force push, branch deletion) without explicit user consent.
- No commits that mix the user's pre-existing WIP files (`libs/go/*/go.{mod,sum}`, `services/{tenant-svc,audit-worker}/go.{mod,sum}`, `tools/scripts/{migrate,seed-demo}.sh`, `apps/web/tsconfig.tsbuildinfo`, `.claude/settings.local.json`) with new feature work — leave those uncommitted unless asked.
