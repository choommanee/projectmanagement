-- +goose Up
CREATE TYPE project_status AS ENUM ('planning','active','on_hold','completed','cancelled');

CREATE TABLE project (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code          TEXT NOT NULL,
    name          TEXT NOT NULL,
    description   TEXT,
    status        project_status NOT NULL DEFAULT 'planning',
    owner_id      UUID,
    start_date    DATE,
    due_date      DATE,
    progress_pct  INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
    tags          TEXT[] NOT NULL DEFAULT '{}',
    settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    version       INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, code)
);

CREATE INDEX project_tenant_status_idx ON project(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX project_tenant_due_idx ON project(tenant_id, due_date) WHERE deleted_at IS NULL;

ALTER TABLE project ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_tenant_isolation ON project USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE project;
DROP TYPE project_status;
