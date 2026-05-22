-- +goose Up
ALTER TABLE signing_key
    ADD COLUMN not_after      TIMESTAMPTZ NULL,
    ADD COLUMN superseded_by  TEXT        NULL REFERENCES signing_key(kid),
    ADD COLUMN superseded_at  TIMESTAMPTZ NULL;

CREATE INDEX signing_key_active_idx ON signing_key(active);

-- +goose Down
DROP INDEX IF EXISTS signing_key_active_idx;

ALTER TABLE signing_key
    DROP COLUMN IF EXISTS superseded_at,
    DROP COLUMN IF EXISTS superseded_by,
    DROP COLUMN IF EXISTS not_after;
