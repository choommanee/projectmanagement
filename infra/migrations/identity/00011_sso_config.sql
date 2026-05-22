-- +goose Up
-- OIDC federation (Plan #6 Task 5).
--
-- One row per (tenant, IdP) tuple. Phase 1 supports only the OIDC protocol;
-- SAML / WS-Fed would come later as additional `provider` values (the column
-- is kept for forward-compat, but the CHECK constraint locks it to 'oidc'
-- until we ship a second connector).
--
-- client_secret_encrypted holds the AES-256-GCM ciphertext of the IdP's
-- client_secret (nonce || ciphertext); the key is derived per-tenant via
-- HKDF-SHA256(SSO_MASTER_KEY, salt=tenant_id_bytes, info="sso_secret_v1")
-- so a single-tenant ciphertext leak does NOT expose other tenants' secrets.
-- Same envelope shape as 00010_mfa.sql so operators learn one pattern.
--
-- attribute_map is JSON of the form
--   {"email": "email", "name": "name", "groups": "groups"}
-- mapping our internal attribute names to the IdP's ID-token claim keys.
-- Empty/default falls back to the standard OIDC claim names ("email", "name",
-- "groups", "sub").
--
-- allow_jit_provisioning + default_role: when true the OIDC callback will
-- INSERT a new app_user row for an unknown email (random password_hash, never
-- usable for password login) and assign `default_role` (when non-null). When
-- false the callback rejects unknown users with 403 — the operator must
-- pre-provision via tenant-svc / identity-svc admin invite.
CREATE TABLE sso_config (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    provider                 TEXT NOT NULL DEFAULT 'oidc'
        CHECK (provider IN ('oidc')),
    issuer_url               TEXT NOT NULL,
    client_id                TEXT NOT NULL,
    client_secret_encrypted  BYTEA NOT NULL,
    redirect_uri             TEXT NOT NULL,
    scopes                   TEXT[] NOT NULL DEFAULT ARRAY['openid','profile','email']::text[],
    attribute_map            JSONB NOT NULL DEFAULT '{}'::jsonb,
    allow_jit_provisioning   BOOLEAN NOT NULL DEFAULT FALSE,
    default_role             TEXT NULL,
    enabled                  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sso_config_tenant_issuer_client_unique
        UNIQUE (tenant_id, issuer_url, client_id)
);

CREATE INDEX sso_config_tenant_idx ON sso_config(tenant_id) WHERE enabled = TRUE;

ALTER TABLE sso_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY sso_config_tenant_isolation
    ON sso_config USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP POLICY sso_config_tenant_isolation ON sso_config;
DROP TABLE sso_config;
