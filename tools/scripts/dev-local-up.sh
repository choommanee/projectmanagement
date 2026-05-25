#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

cp -n .env.example .env || true
set -a
source .env
set +a

PROFILE="${1:-core}" # core | full
START_WEB="${START_WEB:-1}"

PG_HOST="${POSTGRES_HOST:-localhost}"
PG_PORT="${POSTGRES_PORT:-5432}"
PG_USER="${POSTGRES_USER:-app}"
PG_PASS="${POSTGRES_PASSWORD:-app}"
PG_DB="${POSTGRES_DB:-platform}"
DSN="postgres://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${PG_DB}?sslmode=disable"

LOG_DIR="$ROOT/.tmp/dev-local/logs"
PID_DIR="$ROOT/.tmp/dev-local/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for local mode (install PostgreSQL client)." >&2
  exit 1
fi

if ! PGPASSWORD="$PG_PASS" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "Postgres is not reachable at ${PG_HOST}:${PG_PORT} (db=${PG_DB}, user=${PG_USER})." >&2
  exit 1
fi

echo "Postgres reachable at ${PG_HOST}:${PG_PORT}; applying migrations..."
./tools/scripts/migrate.sh up

start_proc() {
  local name="$1"
  local port="$2"
  local cmd="$3"
  local pid_file="$PID_DIR/$name.pid"
  local log_file="$LOG_DIR/$name.log"

  if lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "[skip] $name already listening on :$port"
    return
  fi

  if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" >/dev/null 2>&1; then
    echo "[skip] $name already running with pid $(cat "$pid_file")"
    return
  fi

  echo "[start] $name -> :$port"
  nohup /bin/zsh -lc "cd '$ROOT'; $cmd" >"$log_file" 2>&1 &
  echo $! >"$pid_file"
}

COMMON_ENV="DATABASE_URL='$DSN' IDENTITY_JWKS_URL='http://localhost:8082/.well-known/jwks.json' JWT_ISSUER='http://localhost:8082'"

start_proc "tenant-svc"        "8081" "$COMMON_ENV PORT=8081 go run ./services/tenant-svc/cmd/server"
start_proc "identity-svc"      "8082" "DATABASE_URL='$DSN' PORT=8082 WEB_URL='${WEB_URL:-http://localhost:3000}' go run ./services/identity-svc/cmd/server"
start_proc "project-svc"       "8083" "$COMMON_ENV PORT=8083 go run ./services/project-svc/cmd/server"
start_proc "document-svc"      "8084" "$COMMON_ENV PORT=8084 go run ./services/document-svc/cmd/server"
start_proc "audit-svc"         "8091" "$COMMON_ENV PORT=8091 go run ./services/audit-svc/cmd/server"
start_proc "reports-svc"       "8092" "$COMMON_ENV PORT=8092 go run ./services/reports-svc/cmd/server"
start_proc "notification-svc"  "8093" "$COMMON_ENV PORT=8093 go run ./services/notification-svc/cmd/server"
start_proc "workflow-runtime"  "8090" "PORT=8090 cargo run -p workflow-runtime"
start_proc "workflow-svc"      "8089" "$COMMON_ENV PORT=8089 WORKFLOW_RUNTIME_URL='http://localhost:8090' go run ./services/workflow-svc/cmd/server"

if [ "$PROFILE" = "full" ]; then
  start_proc "mrp-engine"          "8086" "PORT=8086 cargo run -p mrp-engine"
  start_proc "traceability-engine" "8088" "PORT=8088 cargo run -p traceability-engine"
  start_proc "mfg-svc"             "8085" "$COMMON_ENV PORT=8085 MRP_ENGINE_URL='http://localhost:8086' TRACE_ENGINE_URL='http://localhost:8088' go run ./services/mfg-svc/cmd/server"
  start_proc "quality-svc"         "8087" "$COMMON_ENV PORT=8087 go run ./services/quality-svc/cmd/server"
fi

if [ "$START_WEB" = "1" ]; then
  start_proc "web" "3000" "pnpm --filter web dev"
fi

echo
echo "Local profile '$PROFILE' started."
echo "Logs: $LOG_DIR"
echo "Stop: ./tools/scripts/dev-local-down.sh"
