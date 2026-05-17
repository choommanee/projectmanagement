# 1. Monorepo Layout

Status: Accepted
Date: 2026-05-17

## Context
Polyglot system: Go services, Rust engines, Next.js frontend, shared packages.

## Decision
Single git repo with three workspace managers:
- `go.work` for Go modules under `services/` and `libs/go/`
- root `Cargo.toml` workspace for Rust crates under `engines/` and `libs/rust/`
- `pnpm-workspace.yaml` + Turborepo for TS apps under `apps/` and packages under `packages/`

Per-service migrations under `infra/migrations/<service>/`. Helm umbrella chart in `infra/helm/platform/`.

## Consequences
- One PR can span backend + frontend + migrations.
- CI matrices split per language to avoid coupling.
- Single source of versioning for design tokens consumed by both frontend and Storybook.
