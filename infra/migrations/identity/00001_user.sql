-- +goose Up
CREATE TYPE user_status AS ENUM ('active', 'invited', 'suspended');

CREATE TABLE app_user (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
    email          CITEXT NOT NULL,
    display_name   TEXT NOT NULL,
    status         user_status NOT NULL DEFAULT 'active',
    password_hash  TEXT,
    mfa_secret     TEXT,
    external_idp   TEXT,
    external_sub   TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ,
    version        INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, email),
    UNIQUE (external_idp, external_sub)
);

CREATE INDEX app_user_tenant_idx ON app_user(tenant_id) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE app_user;
DROP TYPE user_status;
