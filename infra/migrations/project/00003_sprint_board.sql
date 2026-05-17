-- +goose Up
CREATE TYPE sprint_status AS ENUM ('planning','active','closed');

CREATE TABLE sprint (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    project_id    UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    goal          TEXT,
    status        sprint_status NOT NULL DEFAULT 'planning',
    start_date    DATE,
    end_date      DATE,
    capacity_pts  INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    version       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE sprint_task (
    sprint_id UUID NOT NULL REFERENCES sprint(id) ON DELETE CASCADE,
    task_id   UUID NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    PRIMARY KEY (sprint_id, task_id)
);

CREATE TABLE board (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    project_id  UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    columns     JSONB NOT NULL DEFAULT '[{"id":"todo","title":"To Do"},{"id":"in_progress","title":"In Progress"},{"id":"review","title":"Review"},{"id":"done","title":"Done"}]'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sprint        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sprint_task   ENABLE ROW LEVEL SECURITY;
ALTER TABLE board         ENABLE ROW LEVEL SECURITY;

CREATE POLICY sprint_tenant_isolation       ON sprint        USING (tenant_id = current_tenant_uuid());
CREATE POLICY sprint_task_tenant_isolation  ON sprint_task   USING (EXISTS (SELECT 1 FROM sprint s WHERE s.id = sprint_id AND s.tenant_id = current_tenant_uuid()));
CREATE POLICY board_tenant_isolation        ON board         USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE board;
DROP TABLE sprint_task;
DROP TABLE sprint;
DROP TYPE sprint_status;
