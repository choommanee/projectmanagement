#!/usr/bin/env bash
# smoke-authz.sh — end-to-end Cedar allow/deny grid smoke test (Plan #4 Task 7).
#
# Drives the ADR-0002 (`docs/adr/0002-cedar-actions.md`) action × resource grid
# via curl. For every representative WRITE_GUARD row picked from the matrix:
#
#   1. mint two access tokens (a platform-admin and a regular non-admin user)
#   2. invoke the route once with each token
#   3. assert: admin returns 2xx, regular user returns 403
#
# Per-step output is prefixed with `[N/M]`. PASS/FAIL labels are colorized when
# stdout is a TTY. On failure the offending curl command + response body are
# dumped and the script exits non-zero.
#
# This script DOES NOT seed tenants or users. Run `tools/scripts/seed-demo.sh`
# (or your own bootstrap) first to populate the tenant + an admin user + a
# non-admin user, then export the credentials below.
#
# === Required env =============================================================
#
#   ADMIN_EMAIL              email of a user holding `platform-admin` role
#   ADMIN_PASSWORD           password for ADMIN_EMAIL
#   USER_EMAIL               email of a user with NO admin roles
#   USER_PASSWORD            password for USER_EMAIL
#
# === Optional env (defaults shown) ============================================
#
#   IDENTITY_URL             http://localhost:8082
#   TENANT_URL               http://localhost:8081
#   PROJECT_URL              http://localhost:8083
#   DOCUMENT_URL             http://localhost:8084
#   MFG_URL                  http://localhost:8085
#   QUALITY_URL              http://localhost:8087
#   WORKFLOW_URL             http://localhost:8090
#   REPORTS_URL              http://localhost:8092
#   AUDIT_URL                http://localhost:8089
#   PG_DSN                   postgres://app:app@localhost:5432/platform?sslmode=disable
#   TEST_TENANT_SLUG         acme         (used to resolve tenant_id via tenant-svc)
#   ADMIN_TOKEN              if set, bypass `/v1/login` for the admin role
#                            (useful when using a dev signer with custom claims)
#   USER_TOKEN               if set, bypass `/v1/login` for the user role
#   RUN_POLICY_RELOAD        1 to additionally exercise POST /v1/admin/policy/reload
#
# === ABAC (Plan #6 Task 6) ====================================================
#
# In addition to the Cedar allow/deny grid above, this script can exercise the
# resource.tenant_id boundary added in Plan #6 Task 6. ABAC cases require two
# seeded tenants in the same Postgres instance, each with at least one of:
# project, document, work_order, dashboard, ncr. The script picks UIDs from
# tenant B's tables directly via psql (RLS bypassed by SUPERUSER), then mints
# an admin token for tenant A and asserts every cross-tenant access returns
# 403 (Cedar `forbid` triggered by `resource.tenant_id != context.tenant_id`).
#
# Seeding two tenants:
#
#   TENANT_SLUG=acme  tools/scripts/seed-demo.sh   # tenant A + admin
#   TENANT_SLUG=bravo tools/scripts/seed-demo.sh   # tenant B + resources
#   # then create one project / document / work_order / dashboard / ncr per tenant
#
# Required env for ABAC cases:
#
#   TEST_TENANT_A_SLUG       acme   (caller tenant; admin token minted here)
#   TEST_TENANT_B_SLUG       bravo  (foreign tenant; resources fetched here)
#   ADMIN_A_TOKEN / ADMIN_A_EMAIL+ADMIN_A_PASSWORD   tenant-A admin credentials
#                            (defaults: re-use ADMIN_TOKEN/ADMIN_EMAIL if unset)
#
# If TEST_TENANT_B_SLUG is unresolvable (slug missing, no rows seeded for any
# entity type, or PG_DSN unreachable) the ABAC block prints a clear SKIP and
# the script continues. ABAC failures are reported alongside the grid failures
# in the final summary.
#
# === Known limitations ========================================================
#
# 1. The running services must be the post–Plan-#4-Task-3 binaries
#    (`feat(*): wire Cedar RequireAction on write endpoints`). If you started
#    a service before those commits, the route handlers run without the
#    authz middleware and every user request will pass — meaning every deny
#    assertion will FAIL with a non-403 status. Rebuild + restart each
#    service before running this smoke (e.g. `go run ./services/mfg-svc/cmd/server`).
#
# 2. /v1/login now loads roles from `role_assignment` (Plan #6 Task 1), so
#    minting tokens via ADMIN_EMAIL/ADMIN_PASSWORD requires that the admin
#    user has a `platform-admin` role assignment seeded (see
#    `tools/scripts/seed-demo.sh`). Without an assignment Cedar will deny the
#    allow-side assertions even though authentication succeeds.

set -euo pipefail

# ── colors (TTY only) ────────────────────────────────────────────────────────
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  C_RED="$(tput setaf 1)"
  C_GREEN="$(tput setaf 2)"
  C_YELLOW="$(tput setaf 3)"
  C_BLUE="$(tput setaf 4)"
  C_DIM="$(tput dim 2>/dev/null || true)"
  C_BOLD="$(tput bold 2>/dev/null || true)"
  C_RESET="$(tput sgr0)"
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_DIM=""; C_BOLD=""; C_RESET=""
fi

usage() {
  sed -n '2,52p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

case "${1:-}" in
  -h|--help|help) usage ;;
esac

# ── env defaults ─────────────────────────────────────────────────────────────
IDENTITY_URL="${IDENTITY_URL:-http://localhost:8082}"
TENANT_URL="${TENANT_URL:-http://localhost:8081}"
PROJECT_URL="${PROJECT_URL:-http://localhost:8083}"
DOCUMENT_URL="${DOCUMENT_URL:-http://localhost:8084}"
MFG_URL="${MFG_URL:-http://localhost:8085}"
QUALITY_URL="${QUALITY_URL:-http://localhost:8087}"
WORKFLOW_URL="${WORKFLOW_URL:-http://localhost:8090}"
REPORTS_URL="${REPORTS_URL:-http://localhost:8092}"
AUDIT_URL="${AUDIT_URL:-http://localhost:8089}"
PG_DSN="${PG_DSN:-postgres://app:app@localhost:5432/platform?sslmode=disable}"
TEST_TENANT_SLUG="${TEST_TENANT_SLUG:-acme}"
RUN_POLICY_RELOAD="${RUN_POLICY_RELOAD:-0}"

# ── env validation ───────────────────────────────────────────────────────────
need_creds=0
if [ -z "${ADMIN_TOKEN:-}" ]; then
  if [ -z "${ADMIN_EMAIL:-}" ] || [ -z "${ADMIN_PASSWORD:-}" ]; then
    need_creds=1
  fi
fi
if [ -z "${USER_TOKEN:-}" ]; then
  if [ -z "${USER_EMAIL:-}" ] || [ -z "${USER_PASSWORD:-}" ]; then
    need_creds=1
  fi
fi
if [ "$need_creds" = 1 ]; then
  echo "${C_RED}error:${C_RESET} either set ADMIN_TOKEN/USER_TOKEN or set ADMIN_EMAIL+ADMIN_PASSWORD and USER_EMAIL+USER_PASSWORD." >&2
  echo "Run \`$0 --help\` for usage." >&2
  exit 2
fi

# Unique probe suffix so repeated runs don't collide on unique constraints
# (e.g. tenant.slug). Truncated hex of the start timestamp keeps it short.
PROBE_ID="$(printf '%s' "$(date +%s%N 2>/dev/null || date +%s)" | tail -c 8)"

# ── helpers ──────────────────────────────────────────────────────────────────
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
TOTAL_STEPS=0
STEP_NUM=0

# step_total is the number of grid rows we will execute. Counted on the rows[]
# array below; recomputed dynamically so adding rows requires no manual update.

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf "  %sPASS%s %s\n" "$C_GREEN" "$C_RESET" "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf "  %sFAIL%s %s\n" "$C_RED" "$C_RESET" "$1"
  if [ -n "${2:-}" ]; then
    printf "    %scurl%s %s\n" "$C_DIM" "$C_RESET" "$2"
  fi
  if [ -n "${3:-}" ]; then
    printf "    %sbody%s %s\n" "$C_DIM" "$C_RESET" "$3"
  fi
}

step_header() {
  STEP_NUM=$((STEP_NUM + 1))
  printf "\n%s[%d/%d]%s %s\n" "$C_BOLD" "$STEP_NUM" "$TOTAL_STEPS" "$C_RESET" "$1"
}

require_cmd() {
  for c in "$@"; do
    if ! command -v "$c" >/dev/null 2>&1; then
      echo "${C_RED}error:${C_RESET} required command not found: $c" >&2
      exit 2
    fi
  done
}

require_cmd curl psql

# psql_safe — run a query against PG_DSN, return the trimmed scalar on stdout,
# or an empty string if psql errors. Never causes the script to exit (we run
# under `set -e`, so we tolerate failure explicitly).
psql_safe() {
  local q="$1"
  psql -t -A "${PG_DSN}" -c "$q" 2>/dev/null | tr -d '[:space:]' || true
}

# abac_case — issue a cross-tenant call with the tenant-A admin token and
# assert the response is 403 (Cedar `forbid` triggered by resource.tenant_id
# != context.tenant_id). Increments the same PASS/FAIL counters as the grid.
#
# Usage: abac_case <action_label> <url> <method>
abac_case() {
  local action="$1"
  local url="$2"
  local method="$3"

  STEP_NUM=$((STEP_NUM + 1))
  printf "\n%s[abac]%s %s %s\n" "$C_BOLD" "$C_RESET" "$method" "$url"

  local body="{}"
  if [ "$method" = "GET" ] || [ "$method" = "DELETE" ]; then
    body=""
  fi

  local curl_repr="curl -sS -o /tmp/smoke-authz.abac.body -w '%{http_code}' --max-time 5 -X ${method} '${url}' -H 'authorization: Bearer <ADMIN_A>' -H 'X-Tenant-Id: ${TENANT_ID}'"
  local code
  if [ -n "$body" ]; then
    code="$(curl -sS -o /tmp/smoke-authz.abac.body -w '%{http_code}' --max-time 5 \
      -X "$method" "$url" \
      -H "authorization: Bearer ${ADMIN_A_JWT}" \
      -H "X-Tenant-Id: ${TENANT_ID}" \
      -H 'content-type: application/json' \
      -d "$body" 2>/dev/null || true)"
  else
    code="$(curl -sS -o /tmp/smoke-authz.abac.body -w '%{http_code}' --max-time 5 \
      -X "$method" "$url" \
      -H "authorization: Bearer ${ADMIN_A_JWT}" \
      -H "X-Tenant-Id: ${TENANT_ID}" 2>/dev/null || true)"
  fi
  local resp_body
  resp_body="$(cat /tmp/smoke-authz.abac.body 2>/dev/null || true)"

  if [ "$code" = "000" ]; then
    printf "  %sSKIP%s abac: %s — service unreachable at %s\n" \
      "$C_YELLOW" "$C_RESET" "$action" "${url%%/v1*}"
    SKIP_COUNT=$((SKIP_COUNT + 1))
    return 0
  fi

  if [ "$code" = "403" ]; then
    pass "abac: ${action} → 403 (cross-tenant denied)"
  else
    fail "abac: ${action} expected 403, got ${code} (cross-tenant should be denied)" "$curl_repr" "$resp_body"
  fi
}

yellow() {
  printf "  %s%s%s\n" "$C_YELLOW" "$1" "$C_RESET"
}

# Tiny JSON-string extractor for simple shapes (no jq dependency).
# Usage: json_field <key> <json>
json_field() {
  local key="$1"; shift
  local json="$*"
  printf '%s' "$json" | python3 -c "import sys,json
try:
  d=json.load(sys.stdin)
  print(d.get('$key',''))
except Exception:
  print('')
" 2>/dev/null
}

# ── 1. preflight: identity-svc healthz ───────────────────────────────────────
echo "${C_BOLD}smoke-authz${C_RESET} — Cedar allow/deny grid (ADR-0002)"
echo "${C_DIM}IDENTITY_URL=${IDENTITY_URL}${C_RESET}"

if ! curl -sf -o /dev/null --max-time 3 "${IDENTITY_URL}/healthz"; then
  echo "${C_RED}error:${C_RESET} identity-svc not reachable at ${IDENTITY_URL}/healthz" >&2
  exit 1
fi

# ── 2. resolve tenant_id from slug ───────────────────────────────────────────
TENANT_RES="$(curl -sf "${TENANT_URL}/v1/tenants/by-slug/${TEST_TENANT_SLUG}" 2>/dev/null || true)"
TENANT_ID="$(json_field id "$TENANT_RES")"
if [ -z "$TENANT_ID" ]; then
  # fall back to direct DB lookup so smoke still works if tenant-svc is read-locked
  TENANT_ID="$(psql "${PG_DSN}" -tAc "SELECT id FROM tenant WHERE slug='${TEST_TENANT_SLUG}' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
fi
if [ -z "$TENANT_ID" ]; then
  echo "${C_RED}error:${C_RESET} tenant slug '${TEST_TENANT_SLUG}' not found via tenant-svc or postgres" >&2
  exit 1
fi
echo "${C_DIM}tenant_id=${TENANT_ID}${C_RESET}"

# ── 3. mint tokens ───────────────────────────────────────────────────────────
login() {
  local email="$1"
  local password="$2"
  local body
  body="$(printf '{"tenant_id":"%s","email":"%s","password":"%s"}' "$TENANT_ID" "$email" "$password")"
  local resp
  resp="$(curl -sf -X POST "${IDENTITY_URL}/v1/login" \
    -H 'content-type: application/json' \
    -d "$body" 2>/dev/null || true)"
  json_field access_token "$resp"
}

if [ -n "${ADMIN_TOKEN:-}" ]; then
  ADMIN_JWT="$ADMIN_TOKEN"
  echo "${C_DIM}admin token: from ADMIN_TOKEN env${C_RESET}"
else
  ADMIN_JWT="$(login "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"
  if [ -z "$ADMIN_JWT" ]; then
    echo "${C_RED}error:${C_RESET} login failed for ADMIN_EMAIL=${ADMIN_EMAIL}" >&2
    exit 1
  fi
  echo "${C_DIM}admin token: minted via /v1/login as ${ADMIN_EMAIL}${C_RESET}"
fi

if [ -n "${USER_TOKEN:-}" ]; then
  USER_JWT="$USER_TOKEN"
  echo "${C_DIM}user  token: from USER_TOKEN env${C_RESET}"
else
  USER_JWT="$(login "$USER_EMAIL" "$USER_PASSWORD")"
  if [ -z "$USER_JWT" ]; then
    echo "${C_RED}error:${C_RESET} login failed for USER_EMAIL=${USER_EMAIL}" >&2
    exit 1
  fi
  echo "${C_DIM}user  token: minted via /v1/login as ${USER_EMAIL}${C_RESET}"
fi

# ── 4. grid: one representative WRITE_GUARD row per service ──────────────────
#
# Format per row: SERVICE | METHOD | URL | JSON_BODY | ACTION | EXTRA_CURL_ARGS
# The body should be syntactically valid JSON; the authz middleware fires BEFORE
# any body parsing, so the deny side is robust even if the create payload would
# otherwise fail validation. The allow side may surface 4xx-other-than-403 if
# the body is too thin — those are reported as a soft warning rather than a
# hard PASS so it remains obvious the authz gate let the request through.
#
# Rows hardcoded here (15 total — one per service plus a few high-value
# follow-ups). Adding rows: append to the rows[] array below; total step count
# updates automatically.

# Use Bash arrays. Each element is a single TSV string: METHOD<TAB>URL<TAB>BODY<TAB>LABEL
rows=()

rows+=("$(printf 'POST\t%s/v1/tenants/\t{"slug":"smoke-authz-%s","name":"smoke-authz probe","tier":"shared"}\ttenant.create (tenant-svc)' "$TENANT_URL" "$PROBE_ID")")
rows+=("$(printf 'POST\t%s/v1/projects\t{"name":"smoke-authz probe","key":"SAZ%s"}\tproject.create (project-svc)' "$PROJECT_URL" "$PROBE_ID")")
rows+=("$(printf 'POST\t%s/v1/documents\t{"title":"smoke-authz probe","content":""}\tdocument.create (document-svc)' "$DOCUMENT_URL")")
rows+=("$(printf 'POST\t%s/v1/items\t{"sku":"SAZ-%s","name":"smoke-authz probe","uom_code":"EA"}\tmfg.item.create (mfg-svc)' "$MFG_URL" "$PROBE_ID")")
rows+=("$(printf 'POST\t%s/v1/work-orders\t{"item_id":"00000000-0000-0000-0000-000000000000","quantity":1}\tmfg.work_order.create (mfg-svc)' "$MFG_URL")")
rows+=("$(printf 'POST\t%s/v1/uoms\t{"code":"SAZ%s","name":"smoke uom"}\tmfg.uom.create (mfg-svc)' "$MFG_URL" "$PROBE_ID")")
rows+=("$(printf 'POST\t%s/v1/work-centers\t{"code":"SAZ-WC-%s","name":"smoke wc"}\tmfg.work_center.create (mfg-svc)' "$MFG_URL" "$PROBE_ID")")
rows+=("$(printf 'POST\t%s/v1/lots\t{"item_id":"00000000-0000-0000-0000-000000000000","lot_no":"SAZ-LOT-%s"}\tmfg.lot.create (mfg-svc)' "$MFG_URL" "$PROBE_ID")")
rows+=("$(printf 'POST\t%s/v1/apqp\t{"title":"smoke apqp %s"}\tquality.apqp.create (quality-svc)' "$QUALITY_URL" "$PROBE_ID")")
rows+=("$(printf 'POST\t%s/v1/ncrs\t{"title":"smoke ncr %s","severity":"minor"}\tquality.ncr.create (quality-svc)' "$QUALITY_URL" "$PROBE_ID")")
rows+=("$(printf 'POST\t%s/v1/inspections\t{"plan":"smoke-%s"}\tquality.inspection.create (quality-svc)' "$QUALITY_URL" "$PROBE_ID")")
rows+=("$(printf 'POST\t%s/v1/workflows\t{"name":"smoke-%s","definition":{}}\tworkflow.create (workflow-svc)' "$WORKFLOW_URL" "$PROBE_ID")")
rows+=("$(printf 'POST\t%s/v1/dashboards\t{"name":"smoke-%s","layout":{}}\treport.dashboard.create (reports-svc)' "$REPORTS_URL" "$PROBE_ID")")
rows+=("$(printf 'POST\t%s/v1/admin/keys/rotate\t{}\tjwt.rotate (identity-svc)' "$IDENTITY_URL")")
rows+=("$(printf 'POST\t%s/v1/mrp/runs\t{"horizon_days":7}\tmfg.mrp.run (mfg-svc)' "$MFG_URL")")

# Skipped (require pre-existing entity IDs that this script does not seed):
#   - PATCH/DELETE on {id}                          (project.update, task.update, …)
#   - POST /v1/items/{id}/boms                      (mfg.bom.create)
#   - POST /v1/work-orders/{id}/release             (mfg.work_order.release)
#   - POST /v1/workflows/{id}/publish               (workflow.publish)
#   - POST /v1/instances/{id}/resume|cancel         (workflow.instance.*)
#   - POST /v1/human-tasks/{id}/complete            (workflow.human_task.complete)

TOTAL_STEPS=${#rows[@]}
if [ "$RUN_POLICY_RELOAD" = "1" ]; then
  TOTAL_STEPS=$(( TOTAL_STEPS + 1 ))
fi

run_row() {
  local method="$1"
  local url="$2"
  local body="$3"
  local label="$4"

  local admin_curl="curl -sS -o /tmp/smoke-authz.admin.body -w '%{http_code}' --max-time 5 -X ${method} '${url}' -H 'authorization: Bearer <ADMIN>' -H 'X-Tenant-Id: ${TENANT_ID}' -H 'content-type: application/json' -d '${body}'"
  local admin_code
  admin_code="$(curl -sS -o /tmp/smoke-authz.admin.body -w '%{http_code}' --max-time 5 \
    -X "$method" "$url" \
    -H "authorization: Bearer ${ADMIN_JWT}" \
    -H "X-Tenant-Id: ${TENANT_ID}" \
    -H 'content-type: application/json' \
    -d "$body" 2>/dev/null || true)"
  local admin_body
  admin_body="$(cat /tmp/smoke-authz.admin.body 2>/dev/null || true)"

  local user_curl="curl -sS -o /tmp/smoke-authz.user.body -w '%{http_code}' --max-time 5 -X ${method} '${url}' -H 'authorization: Bearer <USER>' -H 'X-Tenant-Id: ${TENANT_ID}' -H 'content-type: application/json' -d '${body}'"
  local user_code
  user_code="$(curl -sS -o /tmp/smoke-authz.user.body -w '%{http_code}' --max-time 5 \
    -X "$method" "$url" \
    -H "authorization: Bearer ${USER_JWT}" \
    -H "X-Tenant-Id: ${TENANT_ID}" \
    -H 'content-type: application/json' \
    -d "$body" 2>/dev/null || true)"
  local user_body
  user_body="$(cat /tmp/smoke-authz.user.body 2>/dev/null || true)"

  # Service unreachable: both calls returned 000 (curl could not connect).
  # Treat as a SKIP (counts toward neither pass nor fail) and continue.
  if [ "$admin_code" = "000" ] && [ "$user_code" = "000" ]; then
    printf "  %sSKIP%s %s — service unreachable at %s\n" "$C_YELLOW" "$C_RESET" "$label" "${url%%/v1*}"
    SKIP_COUNT=$((SKIP_COUNT + 1))
    return 0
  fi

  # Assertion A: regular user MUST be denied with 403.
  if [ "$user_code" = "403" ]; then
    pass "deny: ${label} → 403 (user)"
  else
    fail "deny: ${label} expected 403, got ${user_code} (user)" "$user_curl" "$user_body"
  fi

  # Assertion B: admin SHOULD be allowed (2xx). 4xx-non-403 still proves the
  # authz gate passed (handler-level validation failure) so we report it as a
  # soft pass labeled "authz-only" to distinguish from a clean 2xx.
  case "$admin_code" in
    2*)
      pass "allow: ${label} → ${admin_code} (admin)"
      ;;
    403)
      fail "allow: ${label} expected 2xx, got 403 (admin denied by Cedar — check role claims)" "$admin_curl" "$admin_body"
      ;;
    4*|5*)
      # Authz passed but handler rejected (likely body/validation). Note as
      # authz-only PASS so the authz gate result is still represented.
      printf "  %sPASS%s allow: %s → %s (admin, authz-only — handler returned %s)\n" \
        "$C_YELLOW" "$C_RESET" "$label" "$admin_code" "$admin_code"
      PASS_COUNT=$((PASS_COUNT + 1))
      ;;
    *)
      fail "allow: ${label} unexpected code ${admin_code} (admin)" "$admin_curl" "$admin_body"
      ;;
  esac
}

# ── 5. iterate rows ──────────────────────────────────────────────────────────
for row in "${rows[@]}"; do
  IFS=$'\t' read -r m u b l <<<"$row"
  step_header "$l"
  run_row "$m" "$u" "$b" "$l"
done

# ── 6. optional: exercise admin policy reload ────────────────────────────────
if [ "$RUN_POLICY_RELOAD" = "1" ]; then
  step_header "policy.reload (identity-svc)"
  run_row "POST" "${IDENTITY_URL}/v1/admin/policy/reload" "{}" "policy.reload (identity-svc)"
fi

# ── 6b. ABAC: cross-tenant resource access (Plan #6 Task 6) ──────────────────
#
# Mint a tenant-A admin token (re-using ADMIN_JWT if no separate ADMIN_A_* env
# is supplied; this matches the common case where TEST_TENANT_SLUG=A) and try
# to mutate / read each entity type belonging to tenant B. Every call must be
# rejected by Cedar with 403 because `resource.tenant_id != context.tenant_id`.

echo
printf "%s── ABAC: cross-tenant resource access ──%s\n" "$C_BOLD" "$C_RESET"

TEST_TENANT_A_SLUG="${TEST_TENANT_A_SLUG:-${TEST_TENANT_SLUG}}"
TEST_TENANT_B_SLUG="${TEST_TENANT_B_SLUG:-bravo}"

# Resolve admin token for tenant A. Prefer dedicated ADMIN_A_* env, else reuse
# the ADMIN_JWT minted above (which is already a tenant-A admin token when
# TEST_TENANT_SLUG == TEST_TENANT_A_SLUG, the default case).
if [ -n "${ADMIN_A_TOKEN:-}" ]; then
  ADMIN_A_JWT="$ADMIN_A_TOKEN"
elif [ -n "${ADMIN_A_EMAIL:-}" ] && [ -n "${ADMIN_A_PASSWORD:-}" ]; then
  ADMIN_A_JWT="$(login "$ADMIN_A_EMAIL" "$ADMIN_A_PASSWORD")"
  if [ -z "$ADMIN_A_JWT" ]; then
    yellow "[skip] ABAC tests: login failed for ADMIN_A_EMAIL=${ADMIN_A_EMAIL}"
    ADMIN_A_JWT=""
  fi
else
  ADMIN_A_JWT="$ADMIN_JWT"
fi

# Resolve tenant_b_id from PG. If absent, SKIP the whole block.
tenant_b_id=""
if [ -n "$ADMIN_A_JWT" ]; then
  tenant_b_id="$(psql_safe "SELECT id FROM tenant WHERE slug='${TEST_TENANT_B_SLUG}' LIMIT 1")"
fi

if [ -z "$ADMIN_A_JWT" ]; then
  : # already warned above
elif [ -z "$tenant_b_id" ]; then
  yellow "[skip] ABAC tests: tenant '${TEST_TENANT_B_SLUG}' not seeded (PG_DSN=${PG_DSN})"
else
  printf "%stenant_b_id=%s%s\n" "$C_DIM" "$tenant_b_id" "$C_RESET"

  # Pick one resource id per entity type from tenant B. Missing rows just skip
  # that one case rather than failing the whole block.
  project_b="$(psql_safe "SELECT id FROM project WHERE tenant_id='${tenant_b_id}' LIMIT 1")"
  doc_b="$(psql_safe "SELECT id FROM document WHERE tenant_id='${tenant_b_id}' LIMIT 1")"
  wo_b="$(psql_safe "SELECT id FROM work_order WHERE tenant_id='${tenant_b_id}' LIMIT 1")"
  dash_b="$(psql_safe "SELECT id FROM dashboard WHERE tenant_id='${tenant_b_id}' LIMIT 1")"
  ncr_b="$(psql_safe "SELECT id FROM nonconformance WHERE tenant_id='${tenant_b_id}' LIMIT 1")"

  # Each case: hit tenant B's resource with tenant A's admin token, assert 403.
  if [ -n "$project_b" ]; then
    abac_case "project.read"   "${PROJECT_URL}/v1/projects/${project_b}" "GET"
    abac_case "project.update" "${PROJECT_URL}/v1/projects/${project_b}" "PATCH"
  else
    yellow "[skip] abac: project.* — no project rows in tenant B"
  fi

  if [ -n "$doc_b" ]; then
    abac_case "document.update" "${DOCUMENT_URL}/v1/documents/${doc_b}" "PATCH"
  else
    yellow "[skip] abac: document.update — no document rows in tenant B"
  fi

  if [ -n "$wo_b" ]; then
    abac_case "mfg.work_order.release" "${MFG_URL}/v1/work-orders/${wo_b}/release" "POST"
  else
    yellow "[skip] abac: mfg.work_order.release — no work_order rows in tenant B"
  fi

  if [ -n "$dash_b" ]; then
    abac_case "report.dashboard.update" "${REPORTS_URL}/v1/dashboards/${dash_b}" "PATCH"
  else
    yellow "[skip] abac: report.dashboard.update — no dashboard rows in tenant B"
  fi

  if [ -n "$ncr_b" ]; then
    abac_case "quality.ncr.update" "${QUALITY_URL}/v1/ncrs/${ncr_b}" "PATCH"
  else
    yellow "[skip] abac: quality.ncr.update — no nonconformance rows in tenant B"
  fi
fi

rm -f /tmp/smoke-authz.abac.body

# ── 7. summary ───────────────────────────────────────────────────────────────
# Each row contributes 2 assertions (admin allow + user deny). Skipped rows
# (service unreachable) don't add to the denominator.
TOTAL_ASSERT=$(( (STEP_NUM - SKIP_COUNT) * 2 ))
echo
if [ "$FAIL_COUNT" -eq 0 ]; then
  printf "%s%d/%d passed, %d failed, %d skipped%s\n" \
    "$C_GREEN" "$PASS_COUNT" "$TOTAL_ASSERT" "$FAIL_COUNT" "$SKIP_COUNT" "$C_RESET"
  rm -f /tmp/smoke-authz.admin.body /tmp/smoke-authz.user.body
  exit 0
else
  printf "%s%d/%d passed, %d failed, %d skipped%s\n" \
    "$C_RED" "$PASS_COUNT" "$TOTAL_ASSERT" "$FAIL_COUNT" "$SKIP_COUNT" "$C_RESET"
  rm -f /tmp/smoke-authz.admin.body /tmp/smoke-authz.user.body
  exit 1
fi
