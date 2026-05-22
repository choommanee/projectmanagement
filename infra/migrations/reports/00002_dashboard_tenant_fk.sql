-- +goose Up
-- Backfill: reports.dashboard.tenant_id has been NOT NULL since 00001 but lacked
-- an FK back to the tenant table. Add it now. If any orphan rows exist in dev,
-- this migration will fail loudly — fix the data, do not auto-prune here.
ALTER TABLE dashboard
    ADD CONSTRAINT dashboard_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenant(id) ON DELETE CASCADE;

-- +goose Down
ALTER TABLE dashboard DROP CONSTRAINT dashboard_tenant_id_fkey;
