-- +goose Up
CREATE TYPE dashboard_visibility AS ENUM ('private','team','tenant');

CREATE TABLE dashboard (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    owner_id    UUID,
    name        TEXT NOT NULL,
    description TEXT,
    visibility  dashboard_visibility NOT NULL DEFAULT 'private',
    layout      JSONB NOT NULL DEFAULT '[]'::jsonb,
    widgets     JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_pinned   BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    version     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX dashboard_tenant_idx ON dashboard(tenant_id, visibility);

ALTER TABLE dashboard ENABLE ROW LEVEL SECURITY;
CREATE POLICY dashboard_iso ON dashboard USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP POLICY IF EXISTS dashboard_iso ON dashboard;
DROP TABLE IF EXISTS dashboard;
DROP TYPE IF EXISTS dashboard_visibility;
