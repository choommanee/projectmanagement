-- +goose Up

CREATE TYPE quotation_status AS ENUM ('draft','sent','accepted','rejected','expired');
CREATE TABLE quotation (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code          text NOT NULL DEFAULT '',
    customer_id   uuid NOT NULL REFERENCES customer(id),
    title         text NOT NULL DEFAULT '',
    valid_until   date,
    status        quotation_status NOT NULL DEFAULT 'draft',
    total_amount  numeric(14,2) NOT NULL DEFAULT 0,
    notes         text NOT NULL DEFAULT '',
    created_by    uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    version       int NOT NULL DEFAULT 1
);
ALTER TABLE quotation ENABLE ROW LEVEL SECURITY;
CREATE POLICY quotation_tenant ON quotation USING (tenant_id = current_tenant_uuid());
CREATE INDEX quotation_tenant_idx ON quotation(tenant_id, status);
CREATE INDEX quotation_customer_idx ON quotation(tenant_id, customer_id);

CREATE TYPE invoice_status AS ENUM ('draft','sent','paid','overdue','cancelled');
CREATE TABLE sales_invoice (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code        text NOT NULL DEFAULT '',
    so_id       uuid REFERENCES sales_order(id),
    customer_id uuid NOT NULL REFERENCES customer(id),
    issue_date  date NOT NULL DEFAULT CURRENT_DATE,
    due_date    date,
    status      invoice_status NOT NULL DEFAULT 'draft',
    subtotal    numeric(14,2) NOT NULL DEFAULT 0,
    tax         numeric(14,2) NOT NULL DEFAULT 0,
    total       numeric(14,2) NOT NULL DEFAULT 0,
    notes       text NOT NULL DEFAULT '',
    created_by  uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    version     int NOT NULL DEFAULT 1
);
ALTER TABLE sales_invoice ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_invoice_tenant ON sales_invoice USING (tenant_id = current_tenant_uuid());
CREATE INDEX sales_invoice_tenant_idx ON sales_invoice(tenant_id, status);
CREATE INDEX sales_invoice_customer_idx ON sales_invoice(tenant_id, customer_id);

CREATE TYPE shipment_status AS ENUM ('pending','packed','shipped','delivered','returned');
CREATE TABLE shipment (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code             text NOT NULL DEFAULT '',
    so_id            uuid REFERENCES sales_order(id),
    customer_id      uuid REFERENCES customer(id),
    ship_date        date,
    carrier          text NOT NULL DEFAULT '',
    tracking_no      text NOT NULL DEFAULT '',
    delivery_address text NOT NULL DEFAULT '',
    status           shipment_status NOT NULL DEFAULT 'pending',
    notes            text NOT NULL DEFAULT '',
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE shipment ENABLE ROW LEVEL SECURITY;
CREATE POLICY shipment_tenant ON shipment USING (tenant_id = current_tenant_uuid());
CREATE INDEX shipment_tenant_idx ON shipment(tenant_id, status);

CREATE TYPE opportunity_stage AS ENUM ('prospect','qualified','proposal','negotiation','won','lost');
CREATE TABLE opportunity (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    title               text NOT NULL,
    customer_id         uuid NOT NULL REFERENCES customer(id),
    stage               opportunity_stage NOT NULL DEFAULT 'prospect',
    value               numeric(14,2) NOT NULL DEFAULT 0,
    currency            text NOT NULL DEFAULT 'THB',
    expected_close_date date,
    probability         int NOT NULL DEFAULT 0,
    assigned_to         uuid,
    notes               text NOT NULL DEFAULT '',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE opportunity ENABLE ROW LEVEL SECURITY;
CREATE POLICY opportunity_tenant ON opportunity USING (tenant_id = current_tenant_uuid());
CREATE INDEX opportunity_tenant_idx ON opportunity(tenant_id, stage);
CREATE INDEX opportunity_customer_idx ON opportunity(tenant_id, customer_id);

-- +goose Down

DROP TABLE IF EXISTS opportunity;
DROP TABLE IF EXISTS shipment;
DROP TABLE IF EXISTS sales_invoice;
DROP TABLE IF EXISTS quotation;
DROP TYPE IF EXISTS opportunity_stage;
DROP TYPE IF EXISTS shipment_status;
DROP TYPE IF EXISTS invoice_status;
DROP TYPE IF EXISTS quotation_status;
