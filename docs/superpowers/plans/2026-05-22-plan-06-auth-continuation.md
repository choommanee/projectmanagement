# Plan #6 — Auth Continuation (roles in JWT, refresh rotation, password reset, MFA, OIDC, read-side ABAC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every remaining identity / authorization open item across Plans #2 and #4 so the platform can serve real users end-to-end. Phase 1 today: login mints a JWT with hardcoded empty `roles`, no refresh rotation, no password reset, no MFA, no external IdP, and Cedar policies decide everything on `"*"` resources. After Plan #6: roles flow into Cedar context from the database, sessions can be safely long-lived via opaque refresh tokens, password loss is self-recoverable, TOTP MFA is opt-in, OIDC federation lets enterprises bring their IdP, and write-guard policies finally evaluate per-instance resources (`Project::"<id>"` etc.).

**Architecture:** identity-svc keeps the entire auth lifecycle. New tables (`refresh_token`, `password_reset_token`, `mfa_enrollment`, `sso_config`) extend the existing `app_user` + `session` + `signing_key` set, each with the standard tenant-scoped RLS pattern (`tenant_id uuid NOT NULL` + `USING (tenant_id = current_tenant_uuid())`). The OIDC connector uses `coreos/go-oidc/v3` against any compliant IdP (Google, Microsoft Entra, Okta, Keycloak). Roles flow from `role_assignment` → JWT claim `roles []string` → Cedar context — the Cedar engine and `libauth.RequireAction` are unchanged (Plan #4 already builds the right context envelope). Per-instance ABAC introduces a `RequireActionScoped(authz, action, resourceTemplate)` middleware variant that resolves URL params at request time.

**Tech stack:** Go 1.25, pgx/v5, chi, `lestrrat-go/jwx` (already), `coreos/go-oidc/v3` (new), `pquerna/otp/totp` (new for MFA), Goose migrations, real Postgres tests (no DB mocks). No new frontend in this plan — UI for refresh/MFA/SSO ships in a future PM-UI plan.

**Prerequisites:** Plan #2 (DONE), Plan #4 (DONE — Cedar enforcement). The `libs/policy/bundle.cedar` action namespace established by Plan #4 is extended here with new auth.* actions.

---

## File Structure

```
infra/migrations/identity/
├── 00008_refresh_token.sql           # (new)
├── 00009_password_reset.sql          # (new)
├── 00010_mfa.sql                     # (new)
└── 00011_sso_config.sql              # (new — lives in identity even though it references tenants)

services/identity-svc/
├── internal/
│   ├── domain/
│   │   ├── refresh_token.go          # (new)
│   │   ├── password_reset.go         # (new)
│   │   ├── mfa.go                    # (new)
│   │   └── sso.go                    # (new)
│   ├── store/
│   │   ├── refresh_token_store.go    # (new)
│   │   ├── password_reset_store.go   # (new)
│   │   ├── mfa_store.go              # (new)
│   │   └── sso_store.go              # (new)
│   ├── service/
│   │   ├── auth.go                   # MODIFY — load roles into Claims; orchestrate MFA challenge
│   │   ├── refresh.go                # (new)
│   │   ├── password_reset.go         # (new)
│   │   ├── mfa.go                    # (new)
│   │   ├── oidc.go                   # (new)
│   │   └── mailer.go                 # (new — interface only; SMTP impl deferred to notif-svc Plan #7)
│   └── api/
│       ├── handlers.go               # MODIFY — mount new routes
│       ├── refresh_test.go           # (new — real PG)
│       ├── password_reset_test.go    # (new)
│       ├── mfa_test.go               # (new)
│       └── oidc_test.go              # (new)

libs/go/auth/
├── authz.go                          # MODIFY — add RequireActionScoped + resource templating
└── authz_scoped_test.go              # (new)

libs/policy/
├── bundle.cedar                      # MODIFY — add auth.* actions + ABAC sample policies
└── bundle_test.go                    # MODIFY — table rows for new actions + scoped cases
```

---

## Task 1: Roles in JWT claims (smallest, unblocks smoke-authz.sh end-to-end)

Today `services/identity-svc/internal/service/auth.go` mints a JWT with `Roles: []string{}` hardcoded. Cedar policies that gate on `context.roles.contains("...")` therefore always deny. This is the single highest-impact one-file change in the plan.

**Files:**
- Modify: `services/identity-svc/internal/service/auth.go`
- Modify: `services/identity-svc/internal/store/user_store.go` (or wherever `role_assignment` is queried — add a `RolesForUser(ctx, tenantID, userID)` method)
- Modify: `services/identity-svc/internal/api/handlers_test.go` + `cedar_rotate_test.go` if they assert on JWT shape
- Modify: `tools/scripts/smoke-authz.sh` — remove the workaround note added by Plan #4 Task 7 once this lands

- [ ] **Step 1: Store query** — `func (s *UserStore) RolesForUser(ctx context.Context, tenantID, userID uuid.UUID) ([]string, error)` that runs `SELECT r.name FROM role_assignment ra JOIN role r ON r.id = ra.role_id WHERE ra.tenant_id = $1 AND ra.user_id = $2`. RLS-set tenant before the query. Cache nothing — roles must be live.

- [ ] **Step 2: Login wiring** — in `service/auth.go::Login`, after the user is verified, call `RolesForUser` and populate `claims.Roles` (rename if the struct field is different — find it). Keep behavior backward-compatible: if the query returns 0 rows, the JWT still mints with `roles: []`. Just stop hardcoding.

- [ ] **Step 3: Real-PG test** — extend an existing login test (or add a new one) that seeds a tenant + user + role + role_assignment row, calls `Login`, decodes the JWT, asserts `roles` contains the expected role.

- [ ] **Step 4: Smoke script polish** — delete the "ADMIN_TOKEN / USER_TOKEN env override" workaround section in `tools/scripts/smoke-authz.sh` since real login now works end-to-end. Keep the env override available but no longer required.

- [ ] **Step 5: Commit** — `feat(identity): load roles from role_assignment into JWT claims (Plan #6 Task 1)`.

---

## Task 2: Refresh-token rotation endpoint

Phase 1 today: access tokens last 15 minutes, no refresh path. After: opaque refresh tokens stored hashed in PG, single-use (rotated on every `/v1/auth/refresh`).

**Files:**
- Create: `infra/migrations/identity/00008_refresh_token.sql`
- Create: `services/identity-svc/internal/domain/refresh_token.go`
- Create: `services/identity-svc/internal/store/refresh_token_store.go`
- Create: `services/identity-svc/internal/service/refresh.go`
- Modify: `services/identity-svc/internal/service/auth.go` — Login now also issues a refresh token
- Modify: `services/identity-svc/internal/api/handlers.go` — mount `POST /v1/auth/refresh`
- Create: `services/identity-svc/internal/api/refresh_test.go`

- [ ] **Step 1: Schema** — `refresh_token (id, tenant_id, user_id, token_hash (sha256), parent_id NULL, family_id NOT NULL, issued_at, expires_at, revoked_at NULL)`. RLS by tenant_id. Index `(tenant_id, user_id)` + `(family_id)`. `parent_id` + `family_id` enable token reuse detection (rotating a previously-rotated child = entire family revoke).

- [ ] **Step 2: Service** — `Refresh(ctx, presentedToken)` looks up by hash, checks `revoked_at IS NULL AND expires_at > now()`. If token was already rotated (presented but `revoked_at != NULL`), mark the entire `family_id` revoked and return 401 (theft-detection signal). Otherwise: mark presented token revoked, mint a new opaque token, persist with `parent_id` = old, same `family_id`, return new access + refresh pair.

- [ ] **Step 3: Login wiring** — `Login` now returns `{access_token, refresh_token, ...}`. Existing callers / tests that only check access keep working.

- [ ] **Step 4: Endpoint** — `POST /v1/auth/refresh` body `{refresh_token}`; gate is anonymous (no `auth.Require`) — the refresh token itself is the credential.

- [ ] **Step 5: Tests** — real PG. Cases: happy path; reuse detection revokes family; expired token → 401; unknown token → 401.

- [ ] **Step 6: Commit** — `feat(identity): refresh-token rotation with theft detection (Plan #6 Task 2)`.

---

## Task 3: Password reset flow

**Files:**
- Create: `infra/migrations/identity/00009_password_reset.sql`
- Create: `services/identity-svc/internal/domain/password_reset.go`
- Create: `services/identity-svc/internal/store/password_reset_store.go`
- Create: `services/identity-svc/internal/service/password_reset.go`
- Create: `services/identity-svc/internal/service/mailer.go` (interface; SMTP impl deferred to Plan #7 notif-svc — for now a no-op `LogMailer` that prints to stdout)
- Modify: `services/identity-svc/internal/api/handlers.go` — mount routes
- Create: `services/identity-svc/internal/api/password_reset_test.go`
- Modify: `libs/policy/bundle.cedar` — `auth.password.request_reset` and `auth.password.reset` are public (no permit needed); document the choice.

- [ ] **Step 1: Schema** — `password_reset_token (id, tenant_id, user_id, token_hash sha256, expires_at, consumed_at NULL)`. 1h TTL. RLS by tenant_id.

- [ ] **Step 2: Request flow** — `POST /v1/auth/password/request-reset` body `{tenant_slug, email}`. Always returns 200 with `{"message": "if the account exists, an email has been sent"}` to avoid email enumeration. If user exists, generate a 32-byte random token, store hash, call `mailer.Send(...)` (log-only for now).

- [ ] **Step 3: Reset flow** — `POST /v1/auth/password/reset` body `{token, new_password}`. Validate token (hash match, not expired, not consumed), set new bcrypt password hash on `app_user`, mark token consumed, revoke ALL refresh tokens for the user.

- [ ] **Step 4: Tests** — real PG. Happy path; unknown email returns 200 (no enumeration); expired token → 400; reused token → 400; reset revokes refresh tokens.

- [ ] **Step 5: Commit** — `feat(identity): password reset flow with anti-enumeration + family revoke (Plan #6 Task 3)`.

---

## Task 4: MFA enrollment (TOTP)

**Files:**
- Create: `infra/migrations/identity/00010_mfa.sql`
- Create: `services/identity-svc/internal/domain/mfa.go`
- Create: `services/identity-svc/internal/store/mfa_store.go`
- Create: `services/identity-svc/internal/service/mfa.go`
- Modify: `services/identity-svc/internal/service/auth.go` — Login now branches into a step-up flow if user has active MFA enrollment
- Modify: `services/identity-svc/internal/api/handlers.go` — mount enroll/verify/disable + step-up
- Create: `services/identity-svc/internal/api/mfa_test.go`
- New dep in `services/identity-svc/go.mod`: `github.com/pquerna/otp/totp`

- [ ] **Step 1: Schema** — `mfa_enrollment (id, tenant_id, user_id, secret_encrypted bytea, algorithm 'TOTP'|'SMS'|'EMAIL' (TOTP only in Phase 1), confirmed_at NULL, backup_codes_hashed text[], created_at)`. Encrypt secret with an envelope key derived from `MFA_MASTER_KEY` env (HKDF + tenant_id as salt — TODO actual KMS in a later plan).

- [ ] **Step 2: Enroll** — `POST /v1/auth/mfa/enroll` (requires authenticated user). Generates a TOTP secret, returns `{otpauth_url, qr_png_base64, backup_codes (one-time view)}`. Persist with `confirmed_at = NULL` until verify succeeds.

- [ ] **Step 3: Verify** — `POST /v1/auth/mfa/verify` body `{code}`. Validates code, sets `confirmed_at`. Failed codes are rate-limited (5 per 5 min — use a `mfa_attempt` audit row or in-memory token bucket; pick in-memory for now and TODO Redis later).

- [ ] **Step 4: Login step-up** — when Login sees an active MFA enrollment for the user, it returns 200 with `{mfa_required: true, mfa_token}` instead of the access/refresh pair. Client submits `POST /v1/auth/mfa/challenge` body `{mfa_token, code (or backup_code)}` to receive the real pair. `mfa_token` is a short-lived signed JWT (1-min TTL) so we don't need new DB state.

- [ ] **Step 5: Disable** — `POST /v1/auth/mfa/disable` (requires recent password re-verify; pass `{current_password}` in body).

- [ ] **Step 6: Tests** — happy enroll → verify → login step-up; failed code; backup code single-use; disable requires password.

- [ ] **Step 7: Commit** — `feat(identity): TOTP MFA with step-up login + backup codes (Plan #6 Task 4)`.

---

## Task 5: OIDC IdP federation

Generic OIDC connector so a tenant admin can plug Google / Microsoft / Okta / Keycloak.

**Files:**
- Create: `infra/migrations/identity/00011_sso_config.sql`
- Create: `services/identity-svc/internal/domain/sso.go`
- Create: `services/identity-svc/internal/store/sso_store.go`
- Create: `services/identity-svc/internal/service/oidc.go`
- Modify: `services/identity-svc/internal/api/handlers.go` — admin SSO config endpoints + login redirect endpoints
- Create: `services/identity-svc/internal/api/oidc_test.go`
- New dep in `services/identity-svc/go.mod`: `github.com/coreos/go-oidc/v3` + `golang.org/x/oauth2`

- [ ] **Step 1: Schema** — `sso_config (id, tenant_id, provider 'oidc'|'saml' (oidc only Phase 1), issuer_url, client_id, client_secret_encrypted, redirect_uri, scopes text[], attribute_map jsonb, allow_jit_provisioning bool, default_role text NULL, enabled bool, created_at, updated_at)`. RLS by tenant_id.

- [ ] **Step 2: Admin endpoints** — gated by `auth.RequireAction(authz, "tenant.sso.configure", "*")`. Add `auth.sso.configure` permit for `tenant-admin` in `bundle.cedar`.
  - `POST /v1/admin/sso/configs` — create
  - `PATCH /v1/admin/sso/configs/{id}` — update (re-encrypt secret if provided)
  - `DELETE /v1/admin/sso/configs/{id}`
  - `GET /v1/admin/sso/configs`

- [ ] **Step 3: Login flow** —
  - `GET /v1/auth/oidc/{tenant_slug}/start?provider={config_id}` redirects to IdP with a signed state.
  - `GET /v1/auth/oidc/{tenant_slug}/callback?code=...&state=...` validates state, exchanges code, decodes ID token, looks up or JIT-provisions an `app_user` row (`allow_jit_provisioning` flag), looks up roles via `role_assignment`, mints access + refresh tokens, redirects to `${WEB_URL}/auth/complete?access=...` (or returns JSON if `Accept: application/json`).

- [ ] **Step 4: Tests** — use `httptest` + mock OIDC issuer (the `go-oidc` library has a `MockProvider` pattern; if not, hand-roll a tiny mock that serves `.well-known/openid-configuration` + JWKS + token endpoints).

- [ ] **Step 5: Commit** — `feat(identity): OIDC IdP federation with JIT provisioning (Plan #6 Task 5)`.

---

## Task 6: Read-side ABAC scoping (per-instance Cedar resources)

Today every `RequireAction(authz, "<action>", "*")` passes a wildcard resource. After: `RequireActionScoped(authz, "<action>", "<Resource>::{:param}")` resolves the URL path param at request time and passes a typed Cedar resource ref, unlocking ABAC like "user can only edit a Project where they are the owner" or "tenant admins can read every dashboard in their tenant but not cross-tenant".

**Files:**
- Modify: `libs/go/auth/authz.go` — add `RequireActionScoped(authz, action, resourceTemplate)`
- Create: `libs/go/auth/authz_scoped_test.go`
- Modify: every product service's `internal/api/handlers.go` — switch write routes from `RequireAction(..., "*")` to `RequireActionScoped(..., "<Entity>::{:id}")`
- Modify: `libs/policy/bundle.cedar` — add ABAC sample policies that read `resource.tenant_id`, `resource.owner_user`, etc.
- Modify: `libs/policy/bundle_test.go` — table rows for per-instance allow/deny
- Modify: `libs/policy/bundle.go` — `Adapter.IsAllowed` now passes resource attributes if the engine has the entity registered; otherwise wildcards as before

- [ ] **Step 1: Middleware** — `RequireActionScoped(authz, action, template string) func(http.Handler) http.Handler`. The `template` is e.g. `Project::{:id}` — at request time, chi's `chi.URLParam(r, "id")` resolves the actual id; the middleware constructs the Cedar `EntityUID` and passes it as resource. Backward-compatible: if `template` has no `{:param}` placeholders, it's treated as a literal (so `"Tenant::*"` still works).

- [ ] **Step 2: Resource attribute loader** — for ABAC to work the Cedar engine needs entity attributes. Add a `ResourceLoader` interface `func (rl ResourceLoader) LoadAttrs(ctx, uid cedar.EntityUID) (map[string]any, error)`. Per-service implementations look up the entity in their store. Wire-up: `RequireActionScoped` calls the registered loader and merges attrs into the Cedar request.

- [ ] **Step 3: Service rollout** — flip every write route in `tenant-svc / project-svc / document-svc / mfg-svc / quality-svc / workflow-svc / reports-svc` to use `RequireActionScoped` with the correct template. Read-only routes also gain `RequireActionScoped` here (this is the actual Plan #6 read-side step that was deferred from Plan #4 Task 8). Update each service's `cedar_*_test.go` to assert per-instance allow + deny.

- [ ] **Step 4: Policies** — `libs/policy/bundle.cedar` gains ABAC rules. Examples:
  ```cedar
  permit (principal, action == Action::"project.read", resource)
    when { resource.tenant_id == context.tenant_id };
  permit (principal, action == Action::"project.update", resource)
    when { resource.owner_user == principal.id || context.roles.contains("tenant-admin") };
  ```

- [ ] **Step 5: Tests** — `libs/policy/bundle_test.go` grid grows to ~80 rows covering (action, role, resource.tenant_id == ?, resource.owner_user == ?, expected).

- [ ] **Step 6: Commit** — `feat(authz): per-instance ABAC scoping across all product services (Plan #6 Task 6)`.

---

## Task 7: Smoke + docs

- [ ] **Step 1: Smoke run** — `tools/scripts/smoke-authz.sh` should now PASS end-to-end (Task 1 unblocked it; Task 6 added more grid rows). Expand the script with 5-10 ABAC cases asserting `resource.tenant_id` boundaries.

- [ ] **Step 2: ADR-0003** — `docs/adr/0003-auth-architecture.md` documenting: refresh-token family + theft detection model, MFA secret storage + envelope-key rotation, OIDC federation contract (claim mapping), ABAC entity attribute loaders.

- [ ] **Step 3: Update ADR-0002** — flip every `WRITE_GUARD` row's `Guard` column from `"*"` to the actual resource template (e.g. `Project::{:id}`). Add a `READ_GUARD` value for read-side rows that now have scoped policies.

- [ ] **Step 4: Commit** — `docs(adr): 0003 auth architecture + ADR-0002 resource templates (Plan #6 Task 7)`.

---

## Self-review

- The smoke script (`smoke-authz.sh`) is the end-to-end test for Tasks 1–6. If it doesn't pass at the end, something is incomplete — do not declare the plan done.
- SAML federation and WebAuthn remain deferred. They go in a future plan once enterprise SSO demand justifies the complexity (spec §3.5 calls them out).
- Mailer is intentionally a no-op `LogMailer` interface in Task 3 — real SMTP / Teams / Slack delivery lands in Plan #7 (Notifications backend, currently in `git stash` from this session's Wave 4B). Task 3's tests assert that `mailer.Send` was *called*, not that an email was actually delivered.
- MFA rate limiting uses an in-memory token bucket — fine for Phase 1 single-instance dev, but breaks under horizontal scale. Move to Redis when the deploy topology requires more than one identity-svc replica.
- The MFA secret envelope key (`MFA_MASTER_KEY`) is env-loaded, not in a KMS. The plan deliberately scopes that out — a future "Secrets management" plan should add KMS integration with key rotation across `MFA_MASTER_KEY`, `JWT_*` signing keys, and OIDC client secrets in one pass.
- Task 6 (ABAC) is the largest blast radius — it touches every product service's write routes. Land Tasks 1–5 first (smaller, isolated), get a stable build, then do Task 6 in its own commit per service so review and rollback stay tractable.
- The `sso_config` table holds an encrypted client secret column. The implementer must use the same envelope-key pattern as the MFA secret to avoid plain-text secrets in the DB. Document the key derivation in ADR-0003.
- Frontend UI for refresh / MFA / SSO config is out of scope. It lands in a future PM UI plan that sequences after Plan #5.
- Pre-existing user WIP under `libs/go/auth/middleware.go` should be committed (or discarded) before Task 6 starts — Task 6 modifies `libs/go/auth/authz.go` extensively and overlapping uncommitted changes will be painful to reconcile.
- No placeholders. Every code step contains executable content.
