# Migrations

Each service owns its migrations under `infra/migrations/<service>/`.
Shared schema (extensions, common roles) lives in `_shared/`.

Apply all:
```
./tools/scripts/migrate.sh up
```
