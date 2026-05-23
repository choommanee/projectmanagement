# Plan #7 — Notifications backend + multi-channel delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `LogMailer` placeholder added by Plan #6 Task 3 with a real notification service that subscribes to NATS, persists notifications per tenant, exposes a list/mark-read HTTP API the existing `NotificationCenter` UI can consume, and delivers via in-app + email + Teams/Slack/LINE webhook channels (spec §3.5). Pop the foundation work already in `stash@{0}` (Wave 4B from session 2026-05-22) and harden it.

**Architecture:** New `notification-svc` Go service on port 8093. NATS subject `notif.>` is the ingress; messages arrive as `NotifEvent{tenant_id, user_id, kind, title, body, payload, ts}`. Worker goroutine pulls from the subject, persists to `notification` table (tenant-scoped RLS), then fans out to configured channels via per-channel adapters (`InAppChannel`, `EmailChannel`, `TeamsChannel`, `SlackChannel`, `LineChannel`). Per-user channel preferences live in `notification_preference`. Email channel uses SMTP via `gomail.v2`; chat channels post signed webhooks. Identity-svc's `Mailer` interface (Plan #6 Task 3) gets a `NotifSvcMailer` impl that publishes a NATS event instead of logging, closing the placeholder loop.

**Tech stack:** Go 1.25, pgx/v5, chi via `libs/go/httpx`, NATS JetStream via `libs/go/nats`, `gomail.v2` for SMTP, stdlib `net/http` for chat webhooks, Goose migrations, real-PG tests, real-NATS tests where reachable (skip-with-message otherwise).

**Prerequisites:** Plan #2 (DONE), Plan #4 (DONE — Cedar bundle), Plan #6 (DONE — `LogMailer` interface + `Mailer` injection point in identity-svc).

---

## File Structure

```
infra/migrations/notification/
├── 00001_notification.sql                  # (popped from stash)
└── 00002_notification_preference.sql       # (new)

libs/go/notification/
├── go.mod                                  # (popped)
├── event.go                                # (popped — NotifEvent struct)
├── publisher.go                            # (popped — NATS publish helper)
└── publisher_test.go                       # (popped)

services/notification-svc/                  # (popped + extended)
├── go.mod
├── cmd/server/main.go
└── internal/
    ├── domain/
    │   ├── notification.go                 # (popped)
    │   └── preference.go                   # (new)
    ├── store/
    │   ├── notification.go                 # (popped)
    │   ├── notification_test.go            # (popped)
    │   └── preference.go                   # (new)
    ├── service/
    │   ├── service.go                      # (popped — extended for channels)
    │   ├── inapp.go                        # (new)
    │   ├── email.go                        # (new)
    │   ├── teams.go                        # (new)
    │   ├── slack.go                        # (new)
    │   ├── line.go                         # (new)
    │   └── router.go                       # (new — fan-out by preference)
    ├── worker/
    │   ├── worker.go                       # (popped)
    │   └── worker_test.go                  # (popped)
    └── api/
        ├── handlers.go                     # (popped — list/mark-read API)
        └── handlers_test.go                # (popped)

services/identity-svc/internal/service/
└── mailer.go                               # MODIFY — NotifSvcMailer impl alongside LogMailer
```

---

## Task 1: Pop the stash, audit, rebase the foundation

`git stash@{0}` from session 2026-05-22 contains the original Wave 4B notification scaffold plus Wave 4C (MinIO/storage) and Wave 4D (workflow trigger). Pop **only the notification pieces** and forward-port any drift from the intervening Plan #4 + Plan #6 work.

**Files (popped from stash):**
- Add: `infra/migrations/notification/00001_notification.sql`
- Add: `libs/go/notification/{go.mod, event.go, publisher.go, publisher_test.go}`
- Add: `services/notification-svc/**`

- [ ] **Step 1: Targeted unstash** — `git checkout stash@{0} -- infra/migrations/notification/ libs/go/notification/ services/notification-svc/`. Keep the rest of the stash (storage / workflow trigger) for Plans #8 / #9.

- [ ] **Step 2: Forward-port** — read every popped file and fix anything that drifted since 2026-05-22:
  - `services/notification-svc/cmd/server/main.go` should match the Plan #6 Task 5 pattern: load `libpolicy.LoadShared()` + `&libpolicy.Adapter{Policies: ps}` + pass to `api.NewRouter`. Wire the policy bundle even though notif-svc has no write-guard endpoints today (consistency — Plan #8 read-side scoping needs it).
  - `libs/go/notification/publisher.go` should use `libs/go/nats` not raw `nats.go`. Wrap any direct NATS calls.
  - Migration must use `current_tenant_uuid()` (the project-standard function), not `app.tenant_id` or `app.current_tenant` raw `current_setting`.

- [ ] **Step 3: `go work use ./libs/go/notification ./services/notification-svc`** — verify `go.work` has both entries (alpha-sorted under `libs/go/` and `services/`).

- [ ] **Step 4: Apply migration + smoke** — `tools/scripts/migrate.sh up notification`. `cd services/notification-svc && go build ./... && go test ./...` — must pass against real Postgres on `:5432`.

- [ ] **Step 5: Commit** — `feat(notif): pop wave-4b stash + forward-port to Plan #6 conventions (Plan #7 Task 1)`.

---

## Task 2: NATS publisher + Cedar bundle entries

**Files:**
- Modify: `libs/go/notification/publisher.go` (interface + JetStream impl)
- Modify: `libs/policy/bundle.cedar` — add `notif.read` (own user only) + `notif.mark_read` permits
- Modify: `docs/adr/0002-cedar-actions.md` — append notification-svc section

- [ ] **Step 1: Publisher interface** — `type Publisher interface { Publish(ctx, ev NotifEvent) error }`. JetStream impl. Stream name `NOTIF`, subject pattern `notif.{tenant_slug}.{kind}`. Constructor `NewJetStreamPublisher(nc *nats.Conn) (*Publisher, error)` that idempotently creates the stream (`nats.StreamInfo` + `AddStream` if missing).

- [ ] **Step 2: Cedar permits** — `notif.read` and `notif.mark_read` allowed when `resource.user_id == principal.id`. Use the ABAC pattern from Plan #6 Task 6.

- [ ] **Step 3: ADR-0002 row** — append a `## notification-svc` section per existing service shape: `GET /v1/notifications` → `notif.read` → `Notification::{:id}` (read-guard); `POST /v1/notifications/{id}/read` → `notif.mark_read` → `Notification::{:id}`; `POST /v1/notifications/read-all` → `notif.mark_all_read` → `Notification::*`.

- [ ] **Step 4: Tests** — table-driven on the publisher + a permit row per Cedar action in `libs/policy/bundle_test.go` (expand the grid).

- [ ] **Step 5: Commit** — `feat(notif): JetStream publisher + Cedar permits for notif.* (Plan #7 Task 2)`.

---

## Task 3: Preferences + per-user channel routing

**Files:**
- Create: `infra/migrations/notification/00002_notification_preference.sql`
- Create: `services/notification-svc/internal/domain/preference.go`
- Create: `services/notification-svc/internal/store/preference.go`
- Modify: `services/notification-svc/internal/service/service.go` — wire preferences

- [ ] **Step 1: Schema** — `notification_preference (id uuid pk, tenant_id uuid not null, user_id uuid not null, kind text not null, channels text[] not null default '{inapp}', created_at, updated_at)`. UNIQUE `(tenant_id, user_id, kind)`. RLS by tenant_id. Default rows for kinds `user.login`, `password.reset`, `workflow.completed`, `mfg.work_order.released` inserted via a seed function.

- [ ] **Step 2: Store** — `GetPreference(ctx, tenantID, userID, kind)` returns the user's channels or the default. `UpsertPreference(ctx, ...)` for the future UI.

- [ ] **Step 3: Router service** — `func (s *Service) Route(ctx, ev NotifEvent) error` resolves the user's preferences and calls the matching `Channel.Send(ctx, ev)` for each. On any channel error, log and continue (other channels still try).

- [ ] **Step 4: Tests** — real PG. Cases: kind with explicit channels → routes there; kind with no preference → default `inapp`; user with `[]` → no delivery (intentional opt-out).

- [ ] **Step 5: Commit** — `feat(notif): per-user channel preferences (Plan #7 Task 3)`.

---

## Task 4: In-app channel (persist to DB + expose via existing HTTP API)

This is the channel that the existing `NotificationCenter.tsx` UI consumes. The popped stash already has the basic `notification` table + list endpoint; this task adds the `Channel` adapter contract.

**Files:**
- Create: `services/notification-svc/internal/service/inapp.go`
- Modify: `services/notification-svc/internal/api/handlers.go` — add `Channel`-aware insert path
- Modify: `services/notification-svc/internal/api/handlers_test.go` — assert event from worker → row in DB → returned by `GET /v1/notifications`

- [ ] **Step 1: `Channel` interface** — `type Channel interface { Name() string; Send(ctx, ev NotifEvent) error }`. The in-app channel writes the row to `notification` table. RLS-set tenant before insert.

- [ ] **Step 2: End-to-end test** — real NATS + real PG: publish event via `libs/go/notification.Publisher`, assert worker picks it up, in-app channel persists, `GET /v1/notifications` returns it.

- [ ] **Step 3: Commit** — `feat(notif): in-app channel + end-to-end NATS→DB test (Plan #7 Task 4)`.

---

## Task 5: Email channel (SMTP via gomail.v2)

**Files:**
- Modify: `services/notification-svc/go.mod` (add `gopkg.in/gomail.v2`)
- Create: `services/notification-svc/internal/service/email.go`
- Modify: `services/notification-svc/cmd/server/main.go` — wire if `SMTP_HOST` set
- Modify: `services/identity-svc/internal/service/mailer.go` — add `NotifSvcMailer` impl

- [ ] **Step 1: Email channel** — `EmailChannel{dialer *gomail.Dialer, from string}`. Renders `subject = ev.Title`, `body = ev.Body` (plain text). Tenant-aware `From` header read from `tenant.settings -> 'notif_from_email'` if present, else fallback to `SMTP_FROM` env.

- [ ] **Step 2: Identity-svc bridge** — `NotifSvcMailer` implements the `Mailer` interface from Plan #6 Task 3. `Send(ctx, to, subject, body)` publishes a `NotifEvent{kind:"system.email", title:subject, body:body, payload:{to:to}}` to NATS. notif-svc picks it up; the email channel delivers.

- [ ] **Step 3: Wire identity-svc** — `cmd/server/main.go`: if `NATS_URL` set, prefer `NotifSvcMailer`; else fall back to `LogMailer`. Both still work.

- [ ] **Step 4: Tests** — Email channel uses a `*gomail.Dialer` interface so tests can inject a fake. End-to-end test asserts identity-svc password reset triggers `EmailChannel.Send` with the expected `to/subject/body`.

- [ ] **Step 5: Env vars** — add to `.env.example`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_TLS=true|false`.

- [ ] **Step 6: Commit** — `feat(notif): SMTP email channel + identity-svc NotifSvcMailer bridge (Plan #7 Task 5)`.

---

## Task 6: Chat webhook channels (Teams, Slack, LINE)

**Files:**
- Create: `services/notification-svc/internal/service/teams.go`
- Create: `services/notification-svc/internal/service/slack.go`
- Create: `services/notification-svc/internal/service/line.go`
- Modify: `services/notification-svc/internal/service/router.go` — fan-out

- [ ] **Step 1: Tenant webhook config** — each tenant has 0..N webhook URLs (`tenant.settings -> 'webhooks'` JSON: `{teams: "https://...", slack: "https://...", line: "https://..."}`). No new table — the existing `tenant.settings` JSONB is sufficient.

- [ ] **Step 2: Channels** — each channel posts a signed payload (`X-Pmplatform-Signature: hex(hmac_sha256(WEBHOOK_SIGNING_KEY, body))`). Teams uses MessageCard format; Slack uses Block Kit; LINE uses LINE Notify token format. Per-channel `Send` calls `http.NewRequestWithContext` + standard `http.Client{Timeout:5s}`. Retry with exponential backoff up to 3 times on 5xx.

- [ ] **Step 3: Tests** — `httptest.Server` per channel: assert correct payload shape + signature + retry-on-500.

- [ ] **Step 4: Env vars** — `WEBHOOK_SIGNING_KEY` (HMAC key for signatures, 64 hex chars).

- [ ] **Step 5: Commit** — `feat(notif): Teams / Slack / LINE webhook channels with HMAC signing (Plan #7 Task 6)`.

---

## Task 7: Wire product services to publish events

**Files:**
- Modify: `services/identity-svc/internal/service/auth.go` (audit-publish `user.login` already exists; this adds `user.password_reset`)
- Modify: `services/project-svc/internal/service/projects.go` — publish `project.created` / `project.updated`
- Modify: `services/mfg-svc/internal/service/work_orders.go` — publish `mfg.work_order.released`
- Modify: `services/workflow-svc/internal/service/instances.go` — publish `workflow.instance.completed`

- [ ] **Step 1: Producers** — each service's existing audit-publish call gets a sibling `notif.Publish(...)`. Inject `notif.Publisher` interface (build with `libs/go/notification.NewJetStreamPublisher`) into each service in `cmd/server/main.go`.

- [ ] **Step 2: One representative test per service** — assert publish was called with the expected `kind` after the action.

- [ ] **Step 3: Smoke** — `tools/scripts/smoke-notif.sh` (new) — trigger a project create + assert a row appears in `notification` for the assignee within 2s.

- [ ] **Step 4: Commit per service** — keep commits scoped.

---

## Task 8: Helm + observability

**Files:**
- Create: `infra/helm/platform/templates/notification-svc-deployment.yaml`
- Create: `infra/helm/platform/templates/notification-svc-service.yaml`
- Modify: `infra/helm/platform/values.yaml` — add `notification` block
- Modify: `docker-compose.yml` — already covered by stash forward-port if applicable

- [ ] **Step 1: Helm** — copy the Plan #1 commit `692242a` shape (identity/tenant/audit-worker). Port 8093, healthcheck `/healthz`, env block for SMTP + webhook signing + NATS.

- [ ] **Step 2: Image tag** pinned to `0.1.0` (no `:latest`).

- [ ] **Step 3: Commit** — `feat(infra): Helm chart for notification-svc (Plan #7 Task 8)`.

---

## Task 9: Smoke + docs

- [ ] **Step 1: Smoke** — `tools/scripts/smoke-notif.sh` covers: publish event → DB row in `notification` → list endpoint returns it → mark-read flips the row. Optional: assert email/webhook channels by setting `SMTP_HOST=mailhog:1025` and a `httptest.Server`-mocked webhook.

- [ ] **Step 2: ADR-0004** — `docs/adr/0004-notification-architecture.md` documenting: per-tenant settings.webhooks shape, channel signing key derivation, retry semantics, NATS subject pattern, why preferences live on `(tenant_id, user_id, kind)` and not per-channel.

- [ ] **Step 3: Update CLAUDE.md** — add a `## Notifications` paragraph naming `libs/go/notification.Publisher` as the canonical way to emit events from any service.

- [ ] **Step 4: Commit** — `docs(notif): ADR-0004 + smoke script + CLAUDE.md update (Plan #7 Task 9)`.

---

## Self-review

- The `LogMailer` placeholder from Plan #6 Task 3 is closed by Task 5's `NotifSvcMailer`. Once Plan #7 is deployed, identity-svc password-reset emails actually leave the box.
- Teams/Slack/LINE chat channels are the spec §3.5 "in-app + email + webhook + Teams/Slack/LINE" minimum. Push notifications (FCM/APNs) for mobile are deferred to a future "mobile" plan since there's no mobile app yet.
- Email retry uses gomail's built-in retry-on-temp-failure; chat webhook retry is hand-rolled (3 attempts, exp backoff). This asymmetry is fine — email failures are rarer and slower; chat webhooks are common to fail-fast.
- `WEBHOOK_SIGNING_KEY` is a single global key in Phase 1 (one HMAC for all tenants). Per-tenant signing keys are a future hardening.
- Notification retention: rows live forever today. A future cleanup job should soft-delete `read_at IS NOT NULL AND created_at < now() - interval '90 days'`.
- The stashed `notification` table from Wave 4B uses RLS `current_tenant_uuid()` (per Plan #6 convention). If Task 1 finds it uses `current_setting('app.current_tenant')` directly, normalize during the forward-port.
- Notifications UI wiring (NotificationCenter.tsx → real `GET /v1/notifications` endpoint instead of the mock) is OUT OF SCOPE — that's a frontend task that lands in a future PM-UI plan (probably Plan #5 alongside the Gantt/Kanban work, since it touches the shell).
- Pre-existing user WIP under `libs/go/*/go.{mod,sum}` is still uncommitted as of writing. Tasks 1+5+7 add new `libs/go/notification` files and modify `services/identity-svc`; if the user's pending changes overlap, sequence them before Task 1.
- No placeholders. Every code step contains executable content.
