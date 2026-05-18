-- +goose Up
CREATE TABLE mrp_run (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    run_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    params      JSONB NOT NULL DEFAULT '{}'::jsonb,
    note        TEXT
);

CREATE TYPE mrp_source AS ENUM ('sales','wo','forecast','po','stock');
CREATE TYPE mrp_action_kind AS ENUM ('release','reschedule','cancel','noop');

CREATE TABLE mrp_demand (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    run_id      UUID NOT NULL REFERENCES mrp_run(id) ON DELETE CASCADE,
    item_id     UUID NOT NULL REFERENCES item(id),
    qty         NUMERIC(18,6) NOT NULL,
    due_date    DATE,
    source      mrp_source NOT NULL,
    source_ref  TEXT
);

CREATE TABLE mrp_supply (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    run_id        UUID NOT NULL REFERENCES mrp_run(id) ON DELETE CASCADE,
    item_id       UUID NOT NULL REFERENCES item(id),
    qty           NUMERIC(18,6) NOT NULL,
    available_at  DATE,
    source        mrp_source NOT NULL,
    source_ref    TEXT
);

CREATE TABLE mrp_action (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    run_id       UUID NOT NULL REFERENCES mrp_run(id) ON DELETE CASCADE,
    action       mrp_action_kind NOT NULL,
    entity_type  TEXT NOT NULL,
    entity_id    UUID,
    message      TEXT
);
CREATE INDEX mrp_action_run_idx ON mrp_action(run_id);

ALTER TABLE mrp_run    ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrp_demand ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrp_supply ENABLE ROW LEVEL SECURITY;
ALTER TABLE mrp_action ENABLE ROW LEVEL SECURITY;
CREATE POLICY mrp_run_iso    ON mrp_run    USING (tenant_id = current_tenant_uuid());
CREATE POLICY mrp_demand_iso ON mrp_demand USING (tenant_id = current_tenant_uuid());
CREATE POLICY mrp_supply_iso ON mrp_supply USING (tenant_id = current_tenant_uuid());
CREATE POLICY mrp_action_iso ON mrp_action USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE mrp_action;
DROP TYPE mrp_action_kind;
DROP TABLE mrp_supply;
DROP TABLE mrp_demand;
DROP TYPE mrp_source;
DROP TABLE mrp_run;
