-- +goose Up
-- Bring sprint in line with project/task soft-delete semantics.
ALTER TABLE sprint ADD COLUMN deleted_at TIMESTAMPTZ;
CREATE INDEX ix_sprint_tenant_project_active
    ON sprint (tenant_id, project_id)
    WHERE deleted_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS ix_sprint_tenant_project_active;
ALTER TABLE sprint DROP COLUMN deleted_at;
