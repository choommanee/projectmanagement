-- +goose Up
CREATE TABLE region (
    code         TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    active       BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO region(code, display_name) VALUES
  ('ap-southeast-1', 'Singapore'),
  ('ap-southeast-7', 'Bangkok'),
  ('us-east-1', 'N. Virginia'),
  ('eu-central-1', 'Frankfurt');

-- +goose Down
DROP TABLE region;
