-- +goose Up
CREATE TABLE document_comment (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    document_id  UUID NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    parent_id    UUID REFERENCES document_comment(id) ON DELETE CASCADE,
    author_id    UUID,
    body         TEXT NOT NULL,
    anchor       JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ
);

CREATE INDEX comment_document_idx ON document_comment(document_id, created_at);

CREATE TABLE document_template (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    type        document_type NOT NULL,
    name        TEXT NOT NULL,
    body        JSONB NOT NULL,
    is_system   BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, type, name)
);

ALTER TABLE document_comment  ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_template ENABLE ROW LEVEL SECURITY;
CREATE POLICY comment_tenant_isolation  ON document_comment  USING (tenant_id = current_tenant_uuid());
CREATE POLICY template_tenant_isolation ON document_template USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE document_template;
DROP TABLE document_comment;
