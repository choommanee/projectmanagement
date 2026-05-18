-- +goose Up
CREATE TYPE bom_status AS ENUM ('draft','active','obsolete');

CREATE TABLE bom_header (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    item_id         UUID NOT NULL REFERENCES item(id) ON DELETE CASCADE,
    version         INTEGER NOT NULL DEFAULT 1,
    is_default      BOOLEAN NOT NULL DEFAULT true,
    status          bom_status NOT NULL DEFAULT 'draft',
    effective_from  DATE,
    effective_to    DATE,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (item_id, version)
);
CREATE INDEX bom_header_item_idx ON bom_header(tenant_id, item_id, status);

CREATE TABLE bom_line (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    header_id        UUID NOT NULL REFERENCES bom_header(id) ON DELETE CASCADE,
    child_item_id    UUID NOT NULL REFERENCES item(id) ON DELETE RESTRICT,
    qty              NUMERIC(18,6) NOT NULL,
    uom_id           UUID NOT NULL REFERENCES uom(id) ON DELETE RESTRICT,
    alternate_of_id  UUID REFERENCES bom_line(id) ON DELETE SET NULL,
    is_phantom       BOOLEAN NOT NULL DEFAULT false,
    scrap_pct        NUMERIC(5,2) NOT NULL DEFAULT 0,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    notes            TEXT
);
CREATE INDEX bom_line_header_idx ON bom_line(header_id, sort_order);

CREATE TABLE routing_header (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    item_id     UUID NOT NULL REFERENCES item(id) ON DELETE CASCADE,
    version     INTEGER NOT NULL DEFAULT 1,
    is_default  BOOLEAN NOT NULL DEFAULT true,
    status      bom_status NOT NULL DEFAULT 'draft',
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (item_id, version)
);

CREATE TABLE routing_operation (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    routing_id      UUID NOT NULL REFERENCES routing_header(id) ON DELETE CASCADE,
    op_no           INTEGER NOT NULL,
    work_center_id  UUID NOT NULL REFERENCES work_center(id) ON DELETE RESTRICT,
    setup_min       NUMERIC(8,2) NOT NULL DEFAULT 0,
    run_per_unit_min NUMERIC(8,2) NOT NULL DEFAULT 0,
    description     TEXT,
    UNIQUE (routing_id, op_no)
);

ALTER TABLE bom_header        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bom_line          ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_header    ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_operation ENABLE ROW LEVEL SECURITY;
CREATE POLICY bom_header_tenant_isolation        ON bom_header        USING (tenant_id = current_tenant_uuid());
CREATE POLICY bom_line_tenant_isolation          ON bom_line          USING (tenant_id = current_tenant_uuid());
CREATE POLICY routing_header_tenant_isolation    ON routing_header    USING (tenant_id = current_tenant_uuid());
CREATE POLICY routing_operation_tenant_isolation ON routing_operation USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE routing_operation;
DROP TABLE routing_header;
DROP TABLE bom_line;
DROP TABLE bom_header;
DROP TYPE bom_status;
