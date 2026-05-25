#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

MODE="${1:-docker}" # docker | local

if [ "$MODE" = "local" ] || [ "$MODE" = "--local" ]; then
  exec ./tools/scripts/dev-local-down.sh
fi

docker compose down
