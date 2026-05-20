-- +goose Up
CREATE TYPE fmea_type AS ENUM ('pfmea','dfmea');

CREATE TABLE fmea (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    type         fmea_type NOT NULL DEFAULT 'pfmea',
    item_id      UUID REFERENCES item(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    team         TEXT[] NOT NULL DEFAULT '{}',
    status       apqp_status NOT NULL DEFAULT 'not_started',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    version      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE fmea_failure_mode (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    fmea_id       UUID NOT NULL REFERENCES fmea(id) ON DELETE CASCADE,
    function      TEXT NOT NULL,
    failure_mode  TEXT NOT NULL,
    effect        TEXT,
    severity      INTEGER NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 10),
    cause         TEXT,
    occurrence    INTEGER NOT NULL DEFAULT 1 CHECK (occurrence BETWEEN 1 AND 10),
    detection     INTEGER NOT NULL DEFAULT 1 CHECK (detection BETWEEN 1 AND 10),
    rpn           INTEGER GENERATED ALWAYS AS (severity * occurrence * detection) STORED,
    actions       TEXT,
    target_date   DATE,
    sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX fmea_failure_mode_fmea_idx ON fmea_failure_mode(fmea_id, sort_order);

CREATE TABLE control_plan (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    item_id    UUID NOT NULL REFERENCES item(id) ON DELETE RESTRICT,
    name       TEXT NOT NULL,
    status     apqp_status NOT NULL DEFAULT 'not_started',
    version    INTEGER NOT NULL DEFAULT 1,
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE control_plan_characteristic (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    control_plan_id     UUID NOT NULL REFERENCES control_plan(id) ON DELETE CASCADE,
    no                  INTEGER NOT NULL,
    characteristic      TEXT NOT NULL,
    spec                TEXT,
    sample_size         TEXT,
    sample_freq         TEXT,
    measurement_method  TEXT,
    reaction_plan       TEXT,
    sort_order          INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE fmea                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fmea_failure_mode          ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plan               ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plan_characteristic ENABLE ROW LEVEL SECURITY;
CREATE POLICY fmea_iso          ON fmea          USING (tenant_id = current_tenant_uuid());
CREATE POLICY fmea_mode_iso     ON fmea_failure_mode USING (tenant_id = current_tenant_uuid());
CREATE POLICY ctrl_plan_iso     ON control_plan  USING (tenant_id = current_tenant_uuid());
CREATE POLICY ctrl_char_iso     ON control_plan_characteristic USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE control_plan_characteristic;
DROP TABLE control_plan;
DROP TABLE fmea_failure_mode;
DROP TABLE fmea;
DROP TYPE fmea_type;
