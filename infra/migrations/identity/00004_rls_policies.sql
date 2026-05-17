-- +goose Up
ALTER TABLE app_user        ENABLE ROW LEVEL SECURITY;
ALTER TABLE session         ENABLE ROW LEVEL SECURITY;
ALTER TABLE role            ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy          ENABLE ROW LEVEL SECURITY;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION current_tenant_uuid() RETURNS UUID AS $$
DECLARE v TEXT := current_setting('app.current_tenant', true);
BEGIN
    IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
    RETURN v::uuid;
END;
$$ LANGUAGE plpgsql STABLE;
-- +goose StatementEnd

CREATE POLICY app_user_tenant_isolation     ON app_user        USING (tenant_id = current_tenant_uuid());
CREATE POLICY session_tenant_isolation      ON session         USING (tenant_id = current_tenant_uuid());
CREATE POLICY role_tenant_isolation         ON role            USING (tenant_id = current_tenant_uuid());
CREATE POLICY role_assn_tenant_isolation    ON role_assignment USING (tenant_id = current_tenant_uuid());
CREATE POLICY policy_tenant_isolation       ON policy          USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP POLICY policy_tenant_isolation       ON policy;
DROP POLICY role_assn_tenant_isolation    ON role_assignment;
DROP POLICY role_tenant_isolation         ON role;
DROP POLICY session_tenant_isolation      ON session;
DROP POLICY app_user_tenant_isolation     ON app_user;
DROP FUNCTION current_tenant_uuid();
