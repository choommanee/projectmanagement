-- +goose Up
CREATE TABLE IF NOT EXISTS custom_field_definition (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('task','project','work_order','item','document')),
  field_key    TEXT NOT NULL,
  label        TEXT NOT NULL,
  field_type   TEXT NOT NULL CHECK (field_type IN ('text','number','date','dropdown','user','boolean')),
  options      JSONB NOT NULL DEFAULT '[]',
  required     BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type, field_key)
);

ALTER TABLE custom_field_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_definition FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON custom_field_definition
  USING (tenant_id = current_tenant_uuid());

CREATE INDEX ix_custom_field_entity ON custom_field_definition (tenant_id, entity_type);

-- +goose Down
DROP TABLE IF EXISTS custom_field_definition;
