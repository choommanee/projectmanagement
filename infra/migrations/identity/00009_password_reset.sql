-- +goose Up
-- Password reset tokens.
--
-- Anti-enumeration: the request endpoint always returns 200; rows are
-- only inserted when the email actually resolves to an active user. The
-- presented token (32 random bytes hex-encoded) is opaque — we persist
-- only sha256(decoded_bytes) so a DB leak cannot replay outstanding
-- reset links.
--
-- TTL defaults to 1h (PASSWORD_RESET_TTL env). consumed_at is stamped
-- once the token is redeemed so the same link can't be reused.
CREATE TABLE password_reset_token (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    token_hash   BYTEA NOT NULL UNIQUE,
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT   password_reset_token_hash_len CHECK (octet_length(token_hash) = 32)
);

CREATE INDEX password_reset_token_tenant_user_idx ON password_reset_token(tenant_id, user_id);
-- token_hash lookup already covered by the UNIQUE constraint's implicit index.

ALTER TABLE password_reset_token ENABLE ROW LEVEL SECURITY;
CREATE POLICY password_reset_token_tenant_isolation
    ON password_reset_token USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP POLICY password_reset_token_tenant_isolation ON password_reset_token;
DROP TABLE password_reset_token;
