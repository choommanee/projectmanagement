-- +goose Up
CREATE TABLE session (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    ip             INET,
    user_agent     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,
    revoked_at     TIMESTAMPTZ
);

CREATE INDEX session_user_idx ON session(user_id) WHERE revoked_at IS NULL;

-- +goose Down
DROP TABLE session;
