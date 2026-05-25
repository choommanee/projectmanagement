#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PID_DIR="$ROOT/.tmp/dev-local/pids"
LOG_DIR="$ROOT/.tmp/dev-local/logs"

if [ ! -d "$PID_DIR" ]; then
  echo "No local pid directory found: $PID_DIR"
  exit 0
fi

for pid_file in "$PID_DIR"/*.pid; do
  [ -e "$pid_file" ] || continue
  name="$(basename "$pid_file" .pid)"
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" >/dev/null 2>&1; then
    echo "[running] $name (pid $pid)"
  else
    echo "[stale]   $name (pid $pid)"
  fi
done

echo "Logs: $LOG_DIR"
