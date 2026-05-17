-- +goose Up
CREATE TYPE tenant_tier AS ENUM ('shared', 'schema', 'dedicated');
CREATE TYPE tenant_status AS ENUM ('active', 'suspended', 'archived');

CREATE TABLE tenant (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    name          TEXT NOT NULL,
    tier          tenant_tier NOT NULL DEFAULT 'shared',
    status        tenant_status NOT NULL DEFAULT 'active',
    region        TEXT NOT NULL DEFAULT 'ap-southeast-1',
    settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    version       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX tenant_status_idx ON tenant(status) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE tenant;
DROP TYPE tenant_status;
DROP TYPE tenant_tier;
