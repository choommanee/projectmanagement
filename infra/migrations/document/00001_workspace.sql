-- +goose Up
CREATE TYPE workspace_kind AS ENUM ('pm','ba','sa','expert');

CREATE TABLE workspace (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    kind       workspace_kind NOT NULL,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, kind)
);

CREATE INDEX workspace_tenant_idx ON workspace(tenant_id);

ALTER TABLE workspace ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_tenant_isolation ON workspace USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE workspace;
DROP TYPE workspace_kind;
