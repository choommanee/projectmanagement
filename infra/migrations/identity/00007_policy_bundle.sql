-- +goose Up
CREATE TABLE policy_bundle (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    body        TEXT NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID NULL
);
CREATE UNIQUE INDEX policy_bundle_active_idx ON policy_bundle (active) WHERE active;
-- +goose Down
DROP INDEX IF EXISTS policy_bundle_active_idx;
DROP TABLE IF EXISTS policy_bundle;
