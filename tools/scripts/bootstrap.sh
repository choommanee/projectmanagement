#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

command -v go >/dev/null    || { echo "install Go 1.25+"; exit 1; }
command -v cargo >/dev/null || { echo "install Rust 1.83+"; exit 1; }
command -v node >/dev/null  || { echo "install Node 22+"; exit 1; }
command -v pnpm >/dev/null  || { echo "install pnpm 9+"; exit 1; }
command -v goose >/dev/null || go install github.com/pressly/goose/v3/cmd/goose@latest

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found: local mode is still supported via ./tools/scripts/dev-up.sh local"
fi

pnpm install
go work sync
cargo build --workspace
echo "bootstrap complete."
