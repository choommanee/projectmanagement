-- +goose Up

CREATE TABLE task_comment (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    task_id    uuid NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    author_id  uuid NOT NULL,
    body       text NOT NULL CHECK (char_length(body) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_comment_tenant_task_idx ON task_comment(tenant_id, task_id);
ALTER TABLE task_comment ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_comment_tenant_isolation ON task_comment
    USING (tenant_id = current_tenant_uuid());

CREATE TABLE task_activity (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    task_id    uuid NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    actor_id   uuid,
    kind       text NOT NULL,
    old_value  text,
    new_value  text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_activity_tenant_task_idx ON task_activity(tenant_id, task_id);
ALTER TABLE task_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_activity_tenant_isolation ON task_activity
    USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE IF EXISTS task_activity;
DROP TABLE IF EXISTS task_comment;
