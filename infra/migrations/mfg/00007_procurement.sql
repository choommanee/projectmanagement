-- +goose Up

CREATE TABLE supplier (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code           text NOT NULL,
    name           text NOT NULL,
    contact        text NOT NULL DEFAULT '',
    email          text NOT NULL DEFAULT '',
    phone          text NOT NULL DEFAULT '',
    lead_time_days int NOT NULL DEFAULT 0,
    active         boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    version        int NOT NULL DEFAULT 1,
    UNIQUE(tenant_id, code)
);
ALTER TABLE supplier ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_iso ON supplier USING (tenant_id = current_tenant_uuid());
CREATE INDEX supplier_tenant_idx ON supplier(tenant_id, code);

CREATE TYPE po_status AS ENUM ('draft','submitted','approved','partially_received','received','cancelled');

CREATE TABLE purchase_order (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    po_number     text NOT NULL,
    supplier_id   uuid NOT NULL REFERENCES supplier(id),
    status        po_status NOT NULL DEFAULT 'draft',
    order_date    date NOT NULL DEFAULT CURRENT_DATE,
    expected_date date,
    notes         text NOT NULL DEFAULT '',
    created_by    uuid NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    version       int NOT NULL DEFAULT 1,
    UNIQUE(tenant_id, po_number)
);
ALTER TABLE purchase_order ENABLE ROW LEVEL SECURITY;
CREATE POLICY po_iso ON purchase_order USING (tenant_id = current_tenant_uuid());
CREATE INDEX po_tenant_idx ON purchase_order(tenant_id, po_number);
CREATE INDEX po_supplier_idx ON purchase_order(tenant_id, supplier_id);

CREATE TABLE po_line (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    po_id         uuid NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
    item_id       uuid NOT NULL REFERENCES item(id),
    line_no       int NOT NULL,
    qty_ordered   numeric(18,4) NOT NULL,
    qty_received  numeric(18,4) NOT NULL DEFAULT 0,
    unit_price    numeric(18,4) NOT NULL DEFAULT 0,
    uom_id        uuid REFERENCES uom(id),
    notes         text NOT NULL DEFAULT ''
);
ALTER TABLE po_line ENABLE ROW LEVEL SECURITY;
CREATE POLICY po_line_iso ON po_line USING (tenant_id = current_tenant_uuid());
CREATE INDEX po_line_po_idx ON po_line(tenant_id, po_id);

-- +goose Down

DROP TABLE IF EXISTS po_line;
DROP TABLE IF EXISTS purchase_order;
DROP TYPE IF EXISTS po_status;
DROP TABLE IF EXISTS supplier;
