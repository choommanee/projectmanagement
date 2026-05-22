-- +goose Up
-- TOTP MFA enrollment + backup codes (Plan #6 Task 4).
--
-- One row per user. secret_encrypted holds the AES-256-GCM ciphertext of
-- the TOTP shared secret (nonce || ciphertext); the key is derived per-tenant
-- via HKDF-SHA256(MFA_MASTER_KEY, salt=tenant_id_bytes, info="mfa_secret_v1")
-- so a single-tenant leak doesn't compromise the others.
--
-- confirmed_at == NULL means the user generated a secret but never finished
-- the verify step — those rows are functionally unenrolled and are NOT
-- considered when deciding whether to gate login with MFA.
--
-- backup_codes_hashed is an array of bcrypt hashes; each backup code is
-- single-use and the consumed entry is removed in-place on a successful
-- challenge (no separate "used" table needed).
--
-- Phase 1 only supports TOTP, but the column is kept for forward-compat
-- (WebAuthn/U2F would be additional rows in a sibling table, not a new
-- algorithm value here).
CREATE TABLE mfa_enrollment (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id              UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    secret_encrypted     BYTEA NOT NULL,
    algorithm            TEXT NOT NULL DEFAULT 'TOTP'
        CHECK (algorithm IN ('TOTP')),
    confirmed_at         TIMESTAMPTZ NULL,
    backup_codes_hashed  TEXT[] NOT NULL DEFAULT '{}',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT mfa_enrollment_user_unique UNIQUE (user_id)
);

CREATE INDEX mfa_enrollment_tenant_user_idx ON mfa_enrollment(tenant_id, user_id);

ALTER TABLE mfa_enrollment ENABLE ROW LEVEL SECURITY;
CREATE POLICY mfa_enrollment_tenant_isolation
    ON mfa_enrollment USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP POLICY mfa_enrollment_tenant_isolation ON mfa_enrollment;
DROP TABLE mfa_enrollment;
