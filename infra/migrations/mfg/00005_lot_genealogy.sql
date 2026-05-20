-- +goose Up
CREATE TABLE lot_genealogy (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    parent_lot_id   UUID NOT NULL REFERENCES lot(id) ON DELETE CASCADE,
    child_lot_id    UUID NOT NULL REFERENCES lot(id) ON DELETE CASCADE,
    work_order_id   UUID REFERENCES work_order(id) ON DELETE SET NULL,
    qty             NUMERIC(18,6),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (parent_lot_id, child_lot_id)
);
CREATE INDEX lot_geneal_parent_idx ON lot_genealogy(tenant_id, parent_lot_id);
CREATE INDEX lot_geneal_child_idx  ON lot_genealogy(tenant_id, child_lot_id);

ALTER TABLE lot_genealogy ENABLE ROW LEVEL SECURITY;
CREATE POLICY lot_genealogy_iso ON lot_genealogy USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE lot_genealogy;
