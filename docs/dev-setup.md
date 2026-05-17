# Dev Setup

## Prereqs
- Go 1.23, Rust 1.83, Node 22, pnpm 9, Docker Desktop, goose

## Bootstrap
```
./tools/scripts/bootstrap.sh
./tools/scripts/dev-up.sh
./tools/scripts/migrate.sh up
```

## Run a Go service
```
cd services/<svc>
go run ./cmd/server
```

## Run a Rust engine
```
cargo run -p <engine-name>
```

## Run the web app
```
pnpm --filter web dev
```
