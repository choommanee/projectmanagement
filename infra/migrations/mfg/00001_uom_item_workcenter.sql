-- +goose Up
CREATE TABLE uom (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code       TEXT NOT NULL,
    name       TEXT NOT NULL,
    ratio_to_base NUMERIC(18,6) NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, code)
);

CREATE TYPE item_type AS ENUM ('raw','component','assembly','finished','consumable','service');
CREATE TYPE item_status AS ENUM ('active','inactive','obsolete');

CREATE TABLE item (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code           TEXT NOT NULL,
    name           TEXT NOT NULL,
    description    TEXT,
    type           item_type   NOT NULL DEFAULT 'component',
    status         item_status NOT NULL DEFAULT 'active',
    uom_id         UUID NOT NULL REFERENCES uom(id) ON DELETE RESTRICT,
    lot_tracked    BOOLEAN NOT NULL DEFAULT false,
    serial_tracked BOOLEAN NOT NULL DEFAULT false,
    attrs          JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ,
    version        INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, code)
);
CREATE INDEX item_tenant_type_idx ON item(tenant_id, type) WHERE deleted_at IS NULL;

CREATE TYPE wc_type AS ENUM ('machine','labor','cell');
CREATE TABLE work_center (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code         TEXT NOT NULL,
    name         TEXT NOT NULL,
    type         wc_type NOT NULL DEFAULT 'machine',
    capacity_per_day_hrs NUMERIC(8,2) NOT NULL DEFAULT 8,
    status       item_status NOT NULL DEFAULT 'active',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    version      INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, code)
);

ALTER TABLE uom         ENABLE ROW LEVEL SECURITY;
ALTER TABLE item        ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_center ENABLE ROW LEVEL SECURITY;
CREATE POLICY uom_tenant_isolation         ON uom         USING (tenant_id = current_tenant_uuid());
CREATE POLICY item_tenant_isolation        ON item        USING (tenant_id = current_tenant_uuid());
CREATE POLICY work_center_tenant_isolation ON work_center USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE work_center;
DROP TYPE wc_type;
DROP TABLE item;
DROP TYPE item_status;
DROP TYPE item_type;
DROP TABLE uom;
