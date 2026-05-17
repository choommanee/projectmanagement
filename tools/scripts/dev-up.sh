#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
cp -n .env.example .env || true
docker compose up -d
echo "Waiting for Postgres..."
until docker compose exec -T postgres pg_isready -U app >/dev/null 2>&1; do sleep 1; done
echo "Dev environment ready."
