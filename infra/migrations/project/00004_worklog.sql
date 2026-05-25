-- +goose Up
CREATE TABLE IF NOT EXISTS task_worklog (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  task_id     UUID NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  logged_md   NUMERIC(8,2) NOT NULL CHECK (logged_md > 0),
  work_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE task_worklog ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_worklog FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON task_worklog
  USING (tenant_id = current_tenant_uuid());

CREATE INDEX ix_worklog_task   ON task_worklog (tenant_id, task_id);
CREATE INDEX ix_worklog_user   ON task_worklog (tenant_id, user_id);

-- +goose Down
DROP TABLE IF EXISTS task_worklog;
