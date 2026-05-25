#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

MODE="${1:-docker}" # docker | local

if [ "$MODE" = "local" ] || [ "$MODE" = "--local" ]; then
  PROFILE="${2:-core}" # core | full
  exec ./tools/scripts/dev-local-up.sh "$PROFILE"
fi

cp -n .env.example .env || true
docker compose up -d
echo "Waiting for Postgres..."
until docker compose exec -T postgres pg_isready -U app >/dev/null 2>&1; do sleep 1; done
echo "Docker dev environment ready."
