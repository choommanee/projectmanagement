-- +goose Up
-- Refresh-token rotation with theft detection.
--
-- Each issued refresh token is a row. Rotation creates a new row whose
-- parent_id points at the previous one and shares the family_id. Reuse
-- of an already-revoked token in a family signals theft → entire family
-- is revoked.
--
-- token_hash is sha256(decoded_random_bytes) — 32 raw bytes, bytea. We
-- never store the presented plaintext.
CREATE TABLE refresh_token (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    token_hash  BYTEA NOT NULL UNIQUE,
    parent_id   UUID NULL REFERENCES refresh_token(id) ON DELETE SET NULL,
    family_id   UUID NOT NULL,
    issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ NULL,
    CONSTRAINT  refresh_token_hash_len CHECK (octet_length(token_hash) = 32)
);

CREATE INDEX refresh_token_tenant_user_idx ON refresh_token(tenant_id, user_id);
CREATE INDEX refresh_token_family_idx      ON refresh_token(family_id);
-- token_hash lookup already covered by the UNIQUE constraint's implicit index.

ALTER TABLE refresh_token ENABLE ROW LEVEL SECURITY;
CREATE POLICY refresh_token_tenant_isolation
    ON refresh_token USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP POLICY refresh_token_tenant_isolation ON refresh_token;
DROP TABLE refresh_token;
