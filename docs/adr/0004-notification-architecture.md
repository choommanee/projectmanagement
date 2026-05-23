# 4. Notification Architecture

Status: Accepted
Date: 2026-05-23

## Context

Plan #7 introduced a real notification service (`notification-svc`) replacing the
`LogMailer` placeholder from Plan #6. The service needs to:

- Receive events from any product service without tight coupling
- Persist per-user notifications (the `NotificationCenter` UI reads these)
- Fan out to multiple delivery channels (in-app, email, Teams, Slack, LINE)
- Respect per-user channel preferences per event kind
- Be tenant-isolated via RLS

This ADR records the key design decisions so future plans can compose against them.

## Decisions

### 1. NATS JetStream as the event bus

All product services publish `NotifEvent` structs to the `NOTIF` JetStream stream
(`libs/go/notification.Publisher`). The NATS subject pattern is
`notif.{tenant_slug}.{kind}` — the kind segment allows selective consumers in
future (e.g., a dedicated email worker subscribing to `notif.*.system.email`).

notification-svc subscribes with a durable consumer (`notif-worker`) and processes
messages sequentially per tenant to preserve ordering within a tenant.

### 2. Per-user channel preferences on `(tenant_id, user_id, kind)`

Preferences are stored in `notification_preference(tenant_id, user_id, kind,
channels text[])`. The composite unique key `(tenant_id, user_id, kind)` means
one preference row per event kind per user per tenant. The default when no row
exists is `{inapp}` (in-app delivery only). An empty `channels` array is a valid
opt-out.

We did not model preferences at a per-channel level (e.g., `email=false,
inapp=true` per kind) because text arrays are simpler and the UI only needs to
present a checklist of channels per kind. The composite key also prevents
duplicate rows without needing application-level upsert guards.

### 3. In-app channel writes to `notification` table

The `InAppChannel` inserts a row into the `notification` table. The existing HTTP
API (`GET /v1/notifications`, `POST /v1/notifications/{id}/read`,
`POST /v1/notifications/read-all`) exposes this to the frontend. This is the
only channel that creates a queryable record; other channels (email, webhooks) are
fire-and-forget with no persistence.

### 4. Email via gomail.v2 with SMTP; identity-svc bridge via NATS

The `EmailChannel` uses `gopkg.in/gomail.v2` and requires `SMTP_HOST` in the
environment. It is only wired if `SMTP_HOST` is set.

Identity-svc's `Mailer` interface (Plan #6 Task 3) is implemented by
`NotifSvcMailer`, which publishes a `NotifEvent{kind:"system.email"}` to NATS
rather than sending email directly. notification-svc's email channel handles
delivery. This keeps identity-svc free of SMTP credentials and lets all mail
delivery go through the same retry / observability path.

Fallback: if `NATS_URL` is not set in identity-svc, `LogMailer` is used instead,
ensuring the service starts cleanly in minimal environments.

### 5. Chat webhooks (Teams, Slack, LINE) with per-tenant config + HMAC signing

Webhook URLs are stored in `tenant.settings` JSONB as:

```json
{
  "webhooks": {
    "teams":  "https://outlook.office.com/webhook/...",
    "slack":  "https://hooks.slack.com/services/...",
    "line":   "https://notify-api.line.me/api/notify"
  }
}
```

No new table is needed. Tenants without a webhook URL for a given channel simply
skip that channel.

All outbound webhook requests carry `X-Pmplatform-Signature:
hex(hmac_sha256(WEBHOOK_SIGNING_KEY, body))` for receiving-end verification.
`WEBHOOK_SIGNING_KEY` is a single global key in Phase 1. Per-tenant signing keys
are deferred (they require a key-management UI and rotation story).

Payload formats:
- **Teams** — Adaptive Card / MessageCard JSON
- **Slack** — Block Kit JSON  
- **LINE** — LINE Notify token bearer request

Each channel retries up to 3 times on 5xx with exponential backoff (500ms, 1s,
2s). 4xx responses are not retried (assume misconfiguration).

### 6. Retention

Notification rows live forever in Phase 1. A future cleanup job should
soft-delete rows where `read_at IS NOT NULL AND created_at < now() - interval '90 days'`.

## Consequences

- Any product service that wants to notify users calls
  `libs/go/notification.Publisher.Publish(ctx, ev)` — one line, no SMTP or
  webhook credentials in the calling service.
- Email and webhook channels are opt-in via env vars / tenant settings; in-app
  delivery works without any external config.
- The `notification_preference` table allows per-user opt-out of any channel,
  but the UI to manage preferences is out of scope for Plan #7 (deferred to PM-UI
  plan).
- WEBHOOK_SIGNING_KEY rotation requires a coordinated deploy; per-tenant keys
  would allow independent rotation and are the recommended next step.
