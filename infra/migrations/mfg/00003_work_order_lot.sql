-- +goose Up
CREATE TYPE wo_status   AS ENUM ('planned','released','in_progress','completed','closed','cancelled');
CREATE TYPE wo_priority AS ENUM ('low','med','high','critical');

CREATE TABLE work_order (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code                TEXT NOT NULL,
    item_id             UUID NOT NULL REFERENCES item(id) ON DELETE RESTRICT,
    qty                 NUMERIC(18,6) NOT NULL CHECK (qty > 0),
    qty_completed       NUMERIC(18,6) NOT NULL DEFAULT 0,
    status              wo_status   NOT NULL DEFAULT 'planned',
    priority            wo_priority NOT NULL DEFAULT 'med',
    due_date            DATE,
    work_center_id      UUID REFERENCES work_center(id),
    start_at            TIMESTAMPTZ,
    end_at              TIMESTAMPTZ,
    routing_header_id   UUID REFERENCES routing_header(id),
    bom_header_id       UUID REFERENCES bom_header(id),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at          TIMESTAMPTZ,
    version             INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, code)
);
CREATE INDEX wo_status_idx ON work_order(tenant_id, status) WHERE deleted_at IS NULL;
CREATE INDEX wo_due_idx    ON work_order(tenant_id, due_date) WHERE deleted_at IS NULL;

CREATE TABLE work_order_operation (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    work_order_id   UUID NOT NULL REFERENCES work_order(id) ON DELETE CASCADE,
    op_no           INTEGER NOT NULL,
    work_center_id  UUID NOT NULL REFERENCES work_center(id),
    setup_min       NUMERIC(8,2) NOT NULL DEFAULT 0,
    run_per_unit_min NUMERIC(8,2) NOT NULL DEFAULT 0,
    description     TEXT,
    qty_done        NUMERIC(18,6) NOT NULL DEFAULT 0,
    status          wo_status NOT NULL DEFAULT 'planned',
    UNIQUE (work_order_id, op_no)
);

CREATE TABLE work_order_material (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    work_order_id   UUID NOT NULL REFERENCES work_order(id) ON DELETE CASCADE,
    item_id         UUID NOT NULL REFERENCES item(id),
    qty_required    NUMERIC(18,6) NOT NULL,
    qty_issued      NUMERIC(18,6) NOT NULL DEFAULT 0,
    uom_id          UUID NOT NULL REFERENCES uom(id)
);

CREATE TYPE lot_status AS ENUM ('released','hold','quarantine','consumed');
CREATE TABLE lot (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    item_id       UUID NOT NULL REFERENCES item(id),
    lot_no        TEXT NOT NULL,
    qty_on_hand   NUMERIC(18,6) NOT NULL DEFAULT 0,
    status        lot_status NOT NULL DEFAULT 'released',
    source_wo_id  UUID REFERENCES work_order(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, item_id, lot_no)
);

ALTER TABLE work_order          ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_order_material  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot                  ENABLE ROW LEVEL SECURITY;
CREATE POLICY wo_tenant_isolation          ON work_order          USING (tenant_id = current_tenant_uuid());
CREATE POLICY wo_op_tenant_isolation       ON work_order_operation USING (tenant_id = current_tenant_uuid());
CREATE POLICY wo_mat_tenant_isolation      ON work_order_material  USING (tenant_id = current_tenant_uuid());
CREATE POLICY lot_tenant_isolation         ON lot                  USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE lot;
DROP TYPE lot_status;
DROP TABLE work_order_material;
DROP TABLE work_order_operation;
DROP TABLE work_order;
DROP TYPE wo_priority;
DROP TYPE wo_status;
