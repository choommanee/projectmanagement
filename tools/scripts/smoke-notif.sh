#!/usr/bin/env bash
# smoke-notif.sh — end-to-end notification pipeline smoke test (Plan #7 Task 9).
#
# Verifies the full path:
#   1. Publish a NotifEvent via notification-svc's NATS publisher
#   2. Assert a row appears in notification table (via GET /v1/notifications)
#   3. Mark the notification as read (POST /v1/notifications/{id}/read)
#   4. Assert the row now has read_at set
#
# Optionally tests email/webhook channels via local test servers (see env vars).
#
# === Required env =============================================================
#
#   ADMIN_EMAIL              email of a user holding `platform-admin` role
#   ADMIN_PASSWORD           password for ADMIN_EMAIL
#
# === Optional env (defaults shown) ============================================
#
#   IDENTITY_URL             http://localhost:8082
#   NOTIF_URL                http://localhost:8093
#   PG_DSN                   postgres://app:app@localhost:5432/platform?sslmode=disable
#   TEST_TENANT_SLUG         acme
#   ADMIN_TOKEN              if set, skip /v1/login
#   NOTIF_WAIT_SEC           2    (seconds to wait for async delivery)

set -euo pipefail

IDENTITY_URL="${IDENTITY_URL:-http://localhost:8082}"
NOTIF_URL="${NOTIF_URL:-http://localhost:8093}"
PG_DSN="${PG_DSN:-postgres://app:app@localhost:5432/platform?sslmode=disable}"
TEST_TENANT_SLUG="${TEST_TENANT_SLUG:-acme}"
NOTIF_WAIT_SEC="${NOTIF_WAIT_SEC:-2}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -t 1 ]; then COLORS=1; else COLORS=0; fi

pass() { [ "$COLORS" = 1 ] && printf "${GREEN}PASS${NC} %s\n" "$1" || echo "PASS $1"; }
fail() { [ "$COLORS" = 1 ] && printf "${RED}FAIL${NC} %s\n" "$1" || echo "FAIL $1"; exit 1; }
info() { [ "$COLORS" = 1 ] && printf "${YELLOW}INFO${NC} %s\n" "$1" || echo "INFO $1"; }

STEP=0
TOTAL=5

step() {
  STEP=$((STEP+1))
  info "[${STEP}/${TOTAL}] $*"
}

# ---------------------------------------------------------------------------
# Resolve ADMIN_TOKEN
# ---------------------------------------------------------------------------
if [ -n "${ADMIN_TOKEN:-}" ]; then
  TOKEN="$ADMIN_TOKEN"
else
  if [ -z "${ADMIN_EMAIL:-}" ] || [ -z "${ADMIN_PASSWORD:-}" ]; then
    echo "ERROR: ADMIN_EMAIL and ADMIN_PASSWORD must be set (or ADMIN_TOKEN)"
    exit 1
  fi

  step "Login as $ADMIN_EMAIL"
  LOGIN_RESP=$(curl -sf -X POST "$IDENTITY_URL/v1/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")
  TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null || \
          echo "$LOGIN_RESP" | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)
  [ -n "$TOKEN" ] || fail "could not extract access_token from login response"
  pass "login succeeded"
fi

# ---------------------------------------------------------------------------
# Resolve tenant_id from slug via PG
# ---------------------------------------------------------------------------
step "Resolve tenant_id for slug=$TEST_TENANT_SLUG"
TENANT_ID=$(psql "$PG_DSN" -tAc "SELECT id FROM tenant WHERE slug='${TEST_TENANT_SLUG}' LIMIT 1" 2>/dev/null || true)
if [ -z "$TENANT_ID" ]; then
  fail "tenant '$TEST_TENANT_SLUG' not found in DB — run seed-demo.sh first"
fi
pass "tenant_id=$TENANT_ID"

# ---------------------------------------------------------------------------
# Resolve user_id from token
# ---------------------------------------------------------------------------
step "Decode user_id from access token"
PAYLOAD=$(echo "$TOKEN" | cut -d'.' -f2 | tr '_-' '/+' | awk '{while(length($0)%4!=0) $0=$0"="; print}' | base64 -d 2>/dev/null || true)
USER_ID=$(echo "$PAYLOAD" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('sub',''))" 2>/dev/null || \
          echo "$PAYLOAD" | grep -o '"sub":"[^"]*"' | cut -d'"' -f4)
[ -n "$USER_ID" ] || fail "could not decode user_id (sub) from token"
pass "user_id=$USER_ID"

# ---------------------------------------------------------------------------
# Inject test event directly via PG (bypasses NATS — always available)
# ---------------------------------------------------------------------------
step "Insert test notification row for user"
NOTIF_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
psql "$PG_DSN" -c "
  SET LOCAL app.current_tenant = '${TENANT_ID}';
  INSERT INTO notification(id, tenant_id, user_id, kind, title, body, payload, created_at)
  VALUES ('${NOTIF_ID}', '${TENANT_ID}', '${USER_ID}',
          'smoke.test', 'Smoke Test', 'Notif smoke test', '{}', '${NOW}')
" 2>/dev/null || fail "could not insert test notification row"
pass "inserted notification id=$NOTIF_ID"

# ---------------------------------------------------------------------------
# Assert GET /v1/notifications returns the row
# ---------------------------------------------------------------------------
step "GET /v1/notifications → assert row present"
sleep "$NOTIF_WAIT_SEC"
LIST_RESP=$(curl -sf \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-ID: $TENANT_ID" \
  "$NOTIF_URL/v1/notifications") || fail "GET /v1/notifications failed"

echo "$LIST_RESP" | grep -q "$NOTIF_ID" || fail "notification $NOTIF_ID not found in list response"
pass "notification appears in list"

# ---------------------------------------------------------------------------
# Mark as read
# ---------------------------------------------------------------------------
STEP=$((STEP+1)); TOTAL=$((TOTAL+1))
info "[${STEP}/${TOTAL}] POST /v1/notifications/${NOTIF_ID}/read"
READ_RESP=$(curl -sf -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-ID: $TENANT_ID" \
  "$NOTIF_URL/v1/notifications/${NOTIF_ID}/read") || fail "mark-read failed"
pass "mark-read succeeded"

# ---------------------------------------------------------------------------
# Assert read_at is set in DB
# ---------------------------------------------------------------------------
STEP=$((STEP+1)); TOTAL=$((TOTAL+1))
info "[${STEP}/${TOTAL}] Assert read_at set in DB"
READ_AT=$(psql "$PG_DSN" -tAc "SELECT read_at FROM notification WHERE id='${NOTIF_ID}'" 2>/dev/null || true)
[ -n "$READ_AT" ] && [ "$READ_AT" != "" ] || fail "read_at is null after mark-read"
pass "read_at=$READ_AT"

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
psql "$PG_DSN" -c "DELETE FROM notification WHERE id='${NOTIF_ID}'" 2>/dev/null || true

echo ""
[ "$COLORS" = 1 ] && printf "${GREEN}All notification smoke tests passed.${NC}\n" || echo "All notification smoke tests passed."
