-- +goose Up

-- stock_balance: one row per (tenant, item, lot, location)
CREATE TABLE IF NOT EXISTS stock_balance (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  item_id      UUID NOT NULL REFERENCES item(id)   ON DELETE CASCADE,
  lot_number   TEXT NOT NULL DEFAULT '',
  location     TEXT NOT NULL DEFAULT 'default',
  qty_on_hand  NUMERIC(14,4) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, item_id, lot_number, location)
);

ALTER TABLE stock_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_balance FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_balance
  USING (tenant_id = current_tenant_uuid());

CREATE INDEX ix_stock_balance_item ON stock_balance (tenant_id, item_id);

-- inventory_transaction: immutable ledger
CREATE TABLE IF NOT EXISTS inventory_transaction (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  item_id      UUID NOT NULL REFERENCES item(id)   ON DELETE CASCADE,
  lot_number   TEXT NOT NULL DEFAULT '',
  location     TEXT NOT NULL DEFAULT 'default',
  txn_type     TEXT NOT NULL CHECK (txn_type IN ('receive','issue','adjust')),
  qty          NUMERIC(14,4) NOT NULL,
  ref_type     TEXT NOT NULL DEFAULT '',
  ref_id       UUID,
  note         TEXT NOT NULL DEFAULT '',
  created_by   UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE inventory_transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transaction FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_transaction
  USING (tenant_id = current_tenant_uuid());

CREATE INDEX ix_inv_txn_item ON inventory_transaction (tenant_id, item_id);
CREATE INDEX ix_inv_txn_date ON inventory_transaction (tenant_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS inventory_transaction;
DROP TABLE IF EXISTS stock_balance;
