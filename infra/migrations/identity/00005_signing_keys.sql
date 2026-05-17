-- +goose Up
CREATE TABLE signing_key (
    kid         TEXT PRIMARY KEY,
    private_pem TEXT NOT NULL,
    public_jwk  JSONB NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE signing_key;
