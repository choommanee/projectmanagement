# 3. Auth Architecture (refresh rotation, MFA, OIDC, ABAC)

Status: Accepted
Date: 2026-05-22

## Context

Plan #6 closed the remaining identity gaps from the Plan #2 self-review.
Before Plan #6 the platform shipped with: hardcoded empty roles in every
minted JWT, no refresh-token rotation (single-use bearer with no family
tracking), no password reset flow, no MFA, no external IdP integration,
and a Cedar policy bundle whose every resource was the wildcard `"*"` —
meaning ABAC was nominally evaluated but never bound to a real entity.

After Plan #6 the platform has a real session lifecycle, recoverable
credentials, OIDC federation, and per-instance Cedar resource
enforcement. This ADR records the decisions taken during that work so
later plans can compose against — or deliberately replace — them
without re-deriving the constraints.

## Decision

1. **Roles flow from DB → JWT → Cedar context.** `RolesForUser(ctx,
   tenantID, userID)` loads from `role_assignment` on every login; the
   JWT carries a `roles: []string` claim; Cedar's context envelope at
   `libs/policy/bundle.go::buildContext` already reads this. The
   bundle's allow rules key off `context.roles.contains("…")`. Landed in
   commit `3f7667c`.

2. **Refresh-token family with theft detection.** Refresh tokens are
   opaque 32-byte random values, hex-encoded for transport, and stored
   sha256-hashed in the `refresh_token` table. Each rotation produces a
   child row with `parent_id` set, all sharing one `family_id`.
   Presenting a previously-rotated token revokes the entire family.
   Landed in commit `8921a48`.

3. **Password reset with anti-enumeration.** `POST
   /v1/auth/password/request-reset` always returns 200 regardless of
   whether the email exists. Reset tokens TTL 1h, stored hashed in
   `password_reset_token`. A successful reset revokes all live refresh
   tokens for the user (parallel to session logout). Mail delivery uses
   a `LogMailer` placeholder; the real SMTP/SES path arrives with Plan
   #7 notif-svc. Landed in commit `cf23c51`.

4. **TOTP MFA with envelope-encrypted secrets.** `mfa_enrollment` rows
   store AES-256-GCM ciphertext of the TOTP secret. The data key is
   derived per row via HKDF-SHA256(salt = tenant_id bytes, info =
   "mfa_secret_v1") from the `MFA_MASTER_KEY` env var. Login step-up
   returns a 1-minute `mfa_token` JWT (no access/refresh) when MFA is
   required; the client posts back a TOTP code or one of eight
   single-use backup codes to receive the real token pair. The rate
   limiter is in-memory single-process. Landed in commit `bbde77d`.

5. **OIDC federation, per-tenant.** `sso_config` rows describe one or
   more IdPs per tenant. The state token threaded through the OAuth2
   round-trip is a domain-internal HMAC-SHA256 envelope (key derived via
   HKDF info = "sso_state_v1") — deliberately not a JWT, because it
   never leaves the auth boundary. `go-oidc/v3` handles discovery and
   ID-token verification. Optional JIT provisioning is gated on
   `allow_jit_provisioning`. The IdP client secret is encrypted using
   the same envelope pattern as MFA (separate `SSO_MASTER_KEY`). Landed
   in commit `db8d9c8`.

6. **Per-instance Cedar resources.** A new
   `RequireActionScoped(authz, action, "<Entity>::{:param}")`
   middleware in `libs/go/auth/authz.go` replaces the wildcard resource
   on every write endpoint that has an id path-parameter. Each service
   ships a `ResourceLoader` implementation in
   `services/<svc>/internal/api/cedar_loader.go` that reads `tenant_id`
   (and `owner_user` where applicable) from its own store, running `SET
   LOCAL app.current_tenant` before the query so RLS is honoured. Cedar
   `forbid` rules in `libs/policy/bundle.cedar` deny cross-tenant access
   via `when { resource has tenant_id && resource.tenant_id !=
   context.tenant_id }`. Create endpoints (no id at request time) keep
   `RequireAction(..., "*")` and continue to rely on the existing RLS
   data path. Landed in commits `6c14332, cfd543d, cea2649, 2167b2b,
   498e768, 5201075, bee2487, 28b85bd, 32e5588, f830d0d`.

## Consequences

- One Cedar bundle file (`libs/policy/bundle.cedar`) is the single
  source of truth for both permits (allow lists) and forbids
  (cross-tenant guards). Editing it without simultaneously updating the
  test grid in `libs/policy/bundle_test.go` is the primary risk vector.
  Keep the grid current.

- Envelope keys (`MFA_MASTER_KEY`, `SSO_MASTER_KEY`) are env-loaded, not
  KMS-managed. Rotating them requires re-encrypting every row in
  `mfa_enrollment` / `sso_config` respectively. A future
  secrets-management plan should consolidate this under a real KMS.

- The MFA rate limiter is in-memory single-process. Multi-replica
  deployments effectively raise the cap to N × 5 attempts per window.
  Move to Redis (or a dedicated rate-limit service) before horizontal
  scale-out.

- `ResourceLoader` fails closed: pool errors are surfaced as 403, not
  500. The trade-off is acceptable because the alternative —
  distinguishing "doesn't exist" from "exists but belongs to another
  tenant" on pool failure — leaks entity existence. The 403 path is
  also more uniform for clients.

- SAML federation, WebAuthn, refresh-token sliding expiry, and Cedar
  policy versioning are explicitly deferred to future plans.

## Forward-references

- Plan #7 (notif-svc) replaces the `LogMailer` placeholder with a real
  outbound mail path for password reset, MFA enrolment confirmation,
  and SSO provisioning notices.
- Plan #8 (document storage) will be the first ABAC consumer added
  after this ADR; its `cedar_loader.go` is the canonical template.
- Plan #9 (workflow event triggers) needs to evaluate Cedar against
  resources hydrated by the dispatcher rather than by HTTP middleware;
  expect a second `ResourceLoader` adapter at the workflow boundary.
- A future plan should add KMS-managed envelope keys and a dual-write
  rotation strategy for `mfa_enrollment` / `sso_config`.
