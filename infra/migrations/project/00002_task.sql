-- +goose Up
CREATE TYPE task_type   AS ENUM ('task','subtask','milestone','deliverable','issue','risk','bug');
CREATE TYPE task_status AS ENUM ('todo','in_progress','blocked','review','done','cancelled');
CREATE TYPE task_priority AS ENUM ('low','med','high','critical');
CREATE TYPE dep_type AS ENUM ('fs','ss','ff','sf');

CREATE TABLE task (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    project_id    UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    parent_id     UUID REFERENCES task(id) ON DELETE CASCADE,
    code          TEXT NOT NULL,
    title         TEXT NOT NULL,
    description   TEXT,
    type          task_type     NOT NULL DEFAULT 'task',
    status        task_status   NOT NULL DEFAULT 'todo',
    priority      task_priority NOT NULL DEFAULT 'med',
    assignee_id   UUID,
    reviewer_id   UUID,
    estimate_md   NUMERIC(8,2) NOT NULL DEFAULT 0,
    actual_md     NUMERIC(8,2) NOT NULL DEFAULT 0,
    progress_pct  INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
    start_date    DATE,
    due_date      DATE,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    tags          TEXT[] NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    version       INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, code)
);

CREATE INDEX task_project_status_idx ON task(project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX task_assignee_idx ON task(tenant_id, assignee_id) WHERE deleted_at IS NULL;
CREATE INDEX task_due_idx ON task(tenant_id, due_date) WHERE deleted_at IS NULL;

CREATE TABLE task_dependency (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    predecessor_id    UUID NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    successor_id      UUID NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    type              dep_type NOT NULL DEFAULT 'fs',
    lag_days          INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (predecessor_id, successor_id, type),
    CHECK (predecessor_id <> successor_id)
);

ALTER TABLE task ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_tenant_isolation ON task USING (tenant_id = current_tenant_uuid());

ALTER TABLE task_dependency ENABLE ROW LEVEL SECURITY;
CREATE POLICY task_dep_tenant_isolation ON task_dependency USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE task_dependency;
DROP TABLE task;
DROP TYPE dep_type;
DROP TYPE task_priority;
DROP TYPE task_status;
DROP TYPE task_type;
