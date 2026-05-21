-- +goose Up
CREATE TABLE audit_log (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id      UUID,
    service      TEXT NOT NULL,
    action       TEXT NOT NULL,
    entity_type  TEXT,
    entity_id    TEXT,
    ip           INET,
    result       TEXT NOT NULL DEFAULT 'success',
    before       JSONB,
    after        JSONB,
    meta         JSONB
);
CREATE INDEX audit_tenant_ts_idx      ON audit_log(tenant_id, ts DESC);
CREATE INDEX audit_tenant_service_idx ON audit_log(tenant_id, service, ts DESC);
CREATE INDEX audit_tenant_entity_idx  ON audit_log(tenant_id, entity_type, entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX audit_tenant_user_idx    ON audit_log(tenant_id, user_id) WHERE user_id IS NOT NULL;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_iso ON audit_log USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE audit_log;
