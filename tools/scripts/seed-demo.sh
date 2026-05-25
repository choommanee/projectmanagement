#!/usr/bin/env bash
# seed-demo.sh — idempotent bootstrap of demo tenant + user
# Tenant: slug=demo-co, name="Demo Co Ltd."
# User:   email=demo@demo.co, password=DemoPass#2026
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

TENANT_URL="${TENANT_URL:-http://localhost:8081}"
PG_HOST="${POSTGRES_HOST:-localhost}"
PG_PORT="${POSTGRES_PORT:-5432}"
PG_USER="${POSTGRES_USER:-app}"
PG_PASSWORD="${POSTGRES_PASSWORD:-app}"
PG_DB="${POSTGRES_DB:-platform}"
PG_DSN="${PG_DSN:-postgres://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DB}?sslmode=disable}"

DEMO_SLUG="demo-co"
DEMO_EMAIL="demo@demo.co"
DEMO_PASSWORD="DemoPass#2026"
DEMO_DISPLAY="Demo User"

echo "=== seed-demo: starting ==="

# ── 1. Create or retrieve demo tenant ─────────────────────────────────────────
echo ">> Checking tenant by slug '$DEMO_SLUG'..."
TENANT_JSON=$(curl -sf "$TENANT_URL/v1/tenants/by-slug/$DEMO_SLUG" 2>/dev/null || true)

if [ -z "$TENANT_JSON" ] || echo "$TENANT_JSON" | grep -q '"error"'; then
  echo ">> Tenant not found — creating..."
  TENANT_JSON=$(curl -sf -X POST "$TENANT_URL/v1/tenants" \
    -H "content-type: application/json" \
    -d "{\"slug\":\"$DEMO_SLUG\",\"name\":\"Demo Co Ltd.\",\"tier\":\"shared\"}")
  echo ">> Tenant created."
else
  echo ">> Tenant already exists."
fi

TENANT_ID=$(echo "$TENANT_JSON" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("id") or d.get("ID",""))' 2>/dev/null)
if [ -z "$TENANT_ID" ]; then
  echo "ERROR: Could not parse tenant id from: $TENANT_JSON" >&2
  exit 1
fi
echo ">> Tenant ID: $TENANT_ID"

# ── 2. Check if user already exists ───────────────────────────────────────────
echo ">> Checking if user '$DEMO_EMAIL' already exists..."
EXISTING=$(PGPASSWORD="$PG_PASSWORD" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT id FROM app_user WHERE email = '$DEMO_EMAIL' AND tenant_id = '$TENANT_ID' LIMIT 1;" 2>/dev/null || true)

if [ -n "$EXISTING" ]; then
  echo ">> User already exists (id=$EXISTING). Skipping insert."
  echo ""
  echo "=== seed-demo: complete ==="
  echo "  tenant_id=$TENANT_ID"
  echo "  email=$DEMO_EMAIL"
  echo "  password=$DEMO_PASSWORD"
  exit 0
fi

# ── 3. Compute bcrypt hash via inline Go program ───────────────────────────────
echo ">> Computing bcrypt hash..."

TMPDIR_HASH=$(mktemp -d)
trap 'rm -rf "$TMPDIR_HASH"' EXIT

cat > "$TMPDIR_HASH/main.go" <<'GOEOF'
package main

import (
  "fmt"
  "os"
  "golang.org/x/crypto/bcrypt"
)

func main() {
  if len(os.Args) < 2 {
    fmt.Fprintln(os.Stderr, "usage: bcrypt <password>")
    os.Exit(1)
  }
  h, err := bcrypt.GenerateFromPassword([]byte(os.Args[1]), 12)
  if err != nil {
    fmt.Fprintln(os.Stderr, err)
    os.Exit(1)
  }
  fmt.Print(string(h))
}
GOEOF

# Copy go.mod from identity-svc so we can use golang.org/x/crypto
cp "$ROOT/services/identity-svc/go.mod" "$TMPDIR_HASH/go.mod"
cp "$ROOT/services/identity-svc/go.sum" "$TMPDIR_HASH/go.sum" 2>/dev/null || true
# Update module name to avoid conflicts
sed -i.bak 's|^module.*|module bcrypttool|' "$TMPDIR_HASH/go.mod"

HASH=$(cd "$TMPDIR_HASH" && go run . "$DEMO_PASSWORD" 2>&1)

if [ -z "$HASH" ]; then
  echo "ERROR: failed to compute bcrypt hash" >&2
  exit 1
fi
echo ">> Hash computed."

# ── 4. Insert user via psql (bypassing RLS with SUPERUSER session) ─────────────
echo ">> Inserting user into app_user..."
PGPASSWORD="$PG_PASSWORD" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" <<SQL
BEGIN;
SET LOCAL app.current_tenant = '$TENANT_ID';
INSERT INTO app_user (tenant_id, email, display_name, status, password_hash)
VALUES ('$TENANT_ID'::uuid, '$DEMO_EMAIL', '$DEMO_DISPLAY', 'active', '$HASH')
ON CONFLICT (tenant_id, email) DO NOTHING;
COMMIT;
SQL

echo ""
echo "=== seed-demo: complete ==="
echo "  tenant_id=$TENANT_ID"
echo "  tenant_slug=$DEMO_SLUG"
echo "  email=$DEMO_EMAIL"
echo "  password=$DEMO_PASSWORD"
