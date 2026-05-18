#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

# Source .env if present so POSTGRES_* etc. propagate
if [ -f .env ]; then
  set -a; source .env; set +a
fi

CMD="${1:-up}"
DSN="postgres://${POSTGRES_USER:-app}:${POSTGRES_PASSWORD:-app}@${POSTGRES_HOST:-localhost}:${POSTGRES_PORT:-5433}/${POSTGRES_DB:-platform}?sslmode=disable"

# Apply in dependency order. Each dir gets its own version table to avoid
# the shared goose_db_version cross-contamination across directories.
ORDER=(_shared tenant identity project document)

for name in "${ORDER[@]}"; do
  dir="infra/migrations/$name"
  if [ ! -d "$dir" ]; then continue; fi
  echo ">> migrating $dir against $DSN"
  goose -dir "$dir" -table "goose_db_version_${name}" postgres "$DSN" "$CMD"
done
