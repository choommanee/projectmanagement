#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PID_DIR="$ROOT/.tmp/dev-local/pids"

if [ ! -d "$PID_DIR" ]; then
  echo "No local pid directory found: $PID_DIR"
  exit 0
fi

for pid_file in "$PID_DIR"/*.pid; do
  [ -e "$pid_file" ] || continue
  name="$(basename "$pid_file" .pid)"
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" >/dev/null 2>&1; then
    echo "[stop] $name (pid $pid)"
    kill "$pid" >/dev/null 2>&1 || true
  else
    echo "[stale] $name pid file found but process is not running"
  fi
  rm -f "$pid_file"
done

echo "Local processes stopped."
