#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

CMD="${1:-up}"
DSN="postgres://${POSTGRES_USER:-app}:${POSTGRES_PASSWORD:-app}@${POSTGRES_HOST:-localhost}:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-platform}?sslmode=disable"

for dir in infra/migrations/*/; do
  echo ">> migrating $dir"
  goose -dir "$dir" postgres "$DSN" "$CMD"
done
