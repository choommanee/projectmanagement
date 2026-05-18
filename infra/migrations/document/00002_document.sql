-- +goose Up
CREATE TYPE document_type   AS ENUM (
  -- PM
  'project_charter','status_report','risk_register','issue_log','change_request','stakeholder_register',
  -- BA
  'brd','frd','user_story','use_case','process_flow','rtm',
  -- SA
  'sdd','adr','er_diagram','api_spec','sequence_diagram','tech_stack',
  -- Expert
  'knowledge_article','decision_log','qa','lesson_learned','expertise_profile',
  -- Generic
  'note'
);
CREATE TYPE document_status AS ENUM ('draft','review','approved','archived');

CREATE TABLE document (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    workspace_id        UUID NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    type                document_type   NOT NULL,
    title               TEXT NOT NULL,
    body                JSONB NOT NULL DEFAULT '{"type":"doc","content":[]}'::jsonb,
    status              document_status NOT NULL DEFAULT 'draft',
    owner_id            UUID,
    tags                TEXT[] NOT NULL DEFAULT '{}',
    current_version_id  UUID,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    version             INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX document_workspace_idx ON document(workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX document_project_type_idx ON document(project_id, type) WHERE deleted_at IS NULL;
CREATE INDEX document_status_idx ON document(tenant_id, status) WHERE deleted_at IS NULL;

CREATE TABLE document_version (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id  UUID NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    rev          INTEGER NOT NULL,
    title        TEXT NOT NULL,
    body         JSONB NOT NULL,
    status       document_status NOT NULL,
    created_by   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    note         TEXT,
    UNIQUE (document_id, rev)
);

CREATE INDEX document_version_doc_idx ON document_version(document_id, rev DESC);

ALTER TABLE document ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_tenant_isolation ON document USING (tenant_id = current_tenant_uuid());

ALTER TABLE document_version ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_version_tenant_isolation ON document_version USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE document_version;
DROP TABLE document;
DROP TYPE document_status;
DROP TYPE document_type;
