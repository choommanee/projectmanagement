-- +goose Up

CREATE TABLE customer (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code            text NOT NULL,
    name            text NOT NULL,
    contact         text NOT NULL DEFAULT '',
    email           text NOT NULL DEFAULT '',
    phone           text NOT NULL DEFAULT '',
    billing_address text NOT NULL DEFAULT '',
    active          boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         int NOT NULL DEFAULT 1,
    UNIQUE(tenant_id, code)
);
ALTER TABLE customer ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_iso ON customer USING (tenant_id = current_tenant_uuid());
CREATE INDEX customer_tenant_idx ON customer(tenant_id, code);

CREATE TYPE so_status AS ENUM ('draft','confirmed','shipped','invoiced','cancelled');

CREATE TABLE sales_order (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    so_number       text NOT NULL,
    customer_id     uuid NOT NULL REFERENCES customer(id),
    status          so_status NOT NULL DEFAULT 'draft',
    order_date      date NOT NULL DEFAULT CURRENT_DATE,
    requested_date  date,
    notes           text NOT NULL DEFAULT '',
    created_by      uuid NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         int NOT NULL DEFAULT 1,
    UNIQUE(tenant_id, so_number)
);
ALTER TABLE sales_order ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_iso ON sales_order USING (tenant_id = current_tenant_uuid());
CREATE INDEX so_tenant_idx ON sales_order(tenant_id, so_number);
CREATE INDEX so_customer_idx ON sales_order(tenant_id, customer_id);

CREATE TABLE so_line (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    so_id       uuid NOT NULL REFERENCES sales_order(id) ON DELETE CASCADE,
    item_id     uuid,
    item_desc   text NOT NULL DEFAULT '',
    line_no     int NOT NULL,
    qty_ordered numeric(18,4) NOT NULL,
    qty_shipped numeric(18,4) NOT NULL DEFAULT 0,
    unit_price  numeric(18,4) NOT NULL DEFAULT 0,
    notes       text NOT NULL DEFAULT ''
);
ALTER TABLE so_line ENABLE ROW LEVEL SECURITY;
CREATE POLICY so_line_iso ON so_line USING (tenant_id = current_tenant_uuid());
CREATE INDEX so_line_so_idx ON so_line(tenant_id, so_id);

-- +goose Down

DROP TABLE IF EXISTS so_line;
DROP TABLE IF EXISTS sales_order;
DROP TYPE IF EXISTS so_status;
DROP TABLE IF EXISTS customer;
