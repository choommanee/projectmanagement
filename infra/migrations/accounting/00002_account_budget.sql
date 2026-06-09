-- +goose Up

-- Per-account budget targets. One row per (tenant, account); the budget page
-- edits a single annual target amount per account and compares it against
-- actuals computed from posted journal lines.
CREATE TABLE account_budget (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    account_id  uuid NOT NULL REFERENCES chart_of_account(id) ON DELETE CASCADE,
    amount      numeric(18,4) NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, account_id)
);
ALTER TABLE account_budget ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_budget_iso ON account_budget USING (tenant_id = current_tenant_uuid());
CREATE INDEX account_budget_tenant_idx ON account_budget(tenant_id, account_id);

-- +goose Down
DROP TABLE IF EXISTS account_budget;
