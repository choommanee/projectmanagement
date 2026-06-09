-- +goose Up
-- Real foreign-key linkage from production/procurement records back to the
-- originating sales order. work_order + purchase_order are owned by mfg-svc;
-- sales_order is owned by sales-svc; all share the single `platform` DB so a
-- cross-domain FK is correct here. Nullable (WOs/POs may exist without an
-- originating SO) with ON DELETE SET NULL (deleting an SO must NOT cascade-
-- destroy production/procurement history).

ALTER TABLE work_order
    ADD COLUMN source_so_id uuid REFERENCES sales_order(id) ON DELETE SET NULL;

ALTER TABLE purchase_order
    ADD COLUMN source_so_id uuid REFERENCES sales_order(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS wo_source_so_idx ON work_order(tenant_id, source_so_id);
CREATE INDEX IF NOT EXISTS po_source_so_idx ON purchase_order(tenant_id, source_so_id);

-- +goose Down
DROP INDEX IF EXISTS po_source_so_idx;
DROP INDEX IF EXISTS wo_source_so_idx;

ALTER TABLE purchase_order DROP COLUMN IF EXISTS source_so_id;
ALTER TABLE work_order DROP COLUMN IF EXISTS source_so_id;
