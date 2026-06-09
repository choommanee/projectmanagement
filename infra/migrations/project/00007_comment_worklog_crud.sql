-- +goose Up
-- task_comment: add optimistic-lock version + soft-delete to support
-- PATCH /v1/comments/{id} and DELETE /v1/comments/{id}.
ALTER TABLE task_comment ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE task_comment ADD COLUMN deleted_at TIMESTAMPTZ;
CREATE INDEX ix_task_comment_tenant_task_active
    ON task_comment (tenant_id, task_id)
    WHERE deleted_at IS NULL;

-- task_worklog: add version + updated_at + soft-delete to support
-- PATCH /v1/worklogs/{id} and DELETE /v1/worklogs/{id}.
ALTER TABLE task_worklog ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE task_worklog ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE task_worklog ADD COLUMN deleted_at TIMESTAMPTZ;
CREATE INDEX ix_task_worklog_tenant_task_active
    ON task_worklog (tenant_id, task_id)
    WHERE deleted_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS ix_task_worklog_tenant_task_active;
ALTER TABLE task_worklog DROP COLUMN deleted_at;
ALTER TABLE task_worklog DROP COLUMN updated_at;
ALTER TABLE task_worklog DROP COLUMN version;

DROP INDEX IF EXISTS ix_task_comment_tenant_task_active;
ALTER TABLE task_comment DROP COLUMN deleted_at;
ALTER TABLE task_comment DROP COLUMN version;
