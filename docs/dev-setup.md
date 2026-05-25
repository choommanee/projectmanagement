# Dev Setup

## Prereqs
- Go 1.25+, Rust 1.83+, Node 22+, pnpm 9+, goose
- PostgreSQL 16+ (required for `local` profile)
- Docker Desktop (optional, only for `docker` profile)

## Bootstrap
```
./tools/scripts/bootstrap.sh
```

## Start Development Profile

### 1) Local (no Docker, recommended when RAM is limited)
Core PM stack:
```
./tools/scripts/dev-up.sh local core
```

Full stack (PM + MFG engines/services):
```
./tools/scripts/dev-up.sh local full
```

Stop/check:
```
./tools/scripts/dev-local-status.sh
./tools/scripts/dev-down.sh local
```

### 2) Docker
```
./tools/scripts/dev-up.sh docker
./tools/scripts/dev-down.sh docker
```

## Run Individually (optional)

### Go service
```
cd services/<svc>
go run ./cmd/server
```

### Rust engine
```
cargo run -p <engine-name>
```

### Web app
```
pnpm --filter web dev
```

## Quick Verification
- Web: `http://localhost:3000/pm/home`
- Identity health: `http://localhost:8082/healthz`
- Project health: `http://localhost:8083/healthz`
