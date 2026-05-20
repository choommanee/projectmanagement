-- +goose Up
CREATE TYPE inspection_result AS ENUM ('pass','fail','hold');
CREATE TABLE inspection (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    work_order_id   UUID REFERENCES work_order(id) ON DELETE SET NULL,
    item_id         UUID NOT NULL REFERENCES item(id) ON DELETE RESTRICT,
    lot_id          UUID REFERENCES lot(id) ON DELETE SET NULL,
    inspected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    inspector       TEXT,
    result          inspection_result NOT NULL DEFAULT 'pass',
    measurements    JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes           TEXT
);

CREATE TYPE ncr_status AS ENUM ('open','investigating','corrected','closed');
CREATE TABLE nonconformance (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    item_id         UUID NOT NULL REFERENCES item(id) ON DELETE RESTRICT,
    lot_id          UUID REFERENCES lot(id) ON DELETE SET NULL,
    work_order_id   UUID REFERENCES work_order(id) ON DELETE SET NULL,
    qty             NUMERIC(18,6) NOT NULL DEFAULT 0,
    severity        INTEGER NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
    description     TEXT NOT NULL,
    status          ncr_status NOT NULL DEFAULT 'open',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    version         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE capa (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    nonconformance_id  UUID NOT NULL REFERENCES nonconformance(id) ON DELETE CASCADE,
    root_cause         TEXT,
    action             TEXT,
    owner_id           UUID,
    target_date        DATE,
    status             apqp_status NOT NULL DEFAULT 'not_started',
    evidence           TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE inspection      ENABLE ROW LEVEL SECURITY;
ALTER TABLE nonconformance  ENABLE ROW LEVEL SECURITY;
ALTER TABLE capa            ENABLE ROW LEVEL SECURITY;
CREATE POLICY inspection_iso ON inspection USING (tenant_id = current_tenant_uuid());
CREATE POLICY ncr_iso        ON nonconformance USING (tenant_id = current_tenant_uuid());
CREATE POLICY capa_iso       ON capa USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE capa;
DROP TABLE nonconformance;
DROP TYPE ncr_status;
DROP TABLE inspection;
DROP TYPE inspection_result;
