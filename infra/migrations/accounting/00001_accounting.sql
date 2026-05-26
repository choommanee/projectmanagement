-- +goose Up

CREATE TABLE chart_of_account (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code        text NOT NULL,
    name        text NOT NULL,
    account_type text NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense')),
    currency    text NOT NULL DEFAULT 'THB',
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    version     int NOT NULL DEFAULT 1,
    UNIQUE(tenant_id, code)
);
ALTER TABLE chart_of_account ENABLE ROW LEVEL SECURITY;
CREATE POLICY coa_iso ON chart_of_account USING (tenant_id = current_tenant_uuid());
CREATE INDEX coa_tenant_idx ON chart_of_account(tenant_id, code);

CREATE TYPE je_status AS ENUM ('draft','posted','reversed');

CREATE TABLE journal_entry (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    ref_no      text NOT NULL,
    memo        text NOT NULL DEFAULT '',
    status      je_status NOT NULL DEFAULT 'draft',
    entry_date  date NOT NULL DEFAULT CURRENT_DATE,
    posted_at   timestamptz,
    created_by  uuid NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    version     int NOT NULL DEFAULT 1,
    UNIQUE(tenant_id, ref_no)
);
ALTER TABLE journal_entry ENABLE ROW LEVEL SECURITY;
CREATE POLICY je_iso ON journal_entry USING (tenant_id = current_tenant_uuid());
CREATE INDEX je_tenant_idx ON journal_entry(tenant_id, entry_date);

CREATE TABLE journal_line (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    entry_id    uuid NOT NULL REFERENCES journal_entry(id) ON DELETE CASCADE,
    account_id  uuid NOT NULL REFERENCES chart_of_account(id),
    debit       numeric(18,4) NOT NULL DEFAULT 0,
    credit      numeric(18,4) NOT NULL DEFAULT 0,
    description text NOT NULL DEFAULT '',
    line_no     int NOT NULL DEFAULT 1
);
ALTER TABLE journal_line ENABLE ROW LEVEL SECURITY;
CREATE POLICY jl_iso ON journal_line USING (tenant_id = current_tenant_uuid());
CREATE INDEX jl_entry_idx ON journal_line(tenant_id, entry_id);

CREATE TYPE inv_type AS ENUM ('ar','ap');
CREATE TYPE inv_status AS ENUM ('draft','issued','paid','overdue','cancelled');

CREATE TABLE invoice (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    inv_no      text NOT NULL,
    inv_type    inv_type NOT NULL,
    counterparty_id uuid,
    amount      numeric(18,4) NOT NULL DEFAULT 0,
    currency    text NOT NULL DEFAULT 'THB',
    status      inv_status NOT NULL DEFAULT 'draft',
    issue_date  date NOT NULL DEFAULT CURRENT_DATE,
    due_date    date,
    paid_at     timestamptz,
    ref_so_id   uuid,
    ref_po_id   uuid,
    notes       text NOT NULL DEFAULT '',
    created_by  uuid NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    version     int NOT NULL DEFAULT 1,
    UNIQUE(tenant_id, inv_no)
);
ALTER TABLE invoice ENABLE ROW LEVEL SECURITY;
CREATE POLICY inv_iso ON invoice USING (tenant_id = current_tenant_uuid());
CREATE INDEX inv_tenant_idx ON invoice(tenant_id, inv_type, status);

-- +goose Down
DROP TABLE IF EXISTS journal_line;
DROP TABLE IF EXISTS invoice;
DROP TABLE IF EXISTS journal_entry;
DROP TABLE IF EXISTS chart_of_account;
DROP TYPE IF EXISTS inv_status;
DROP TYPE IF EXISTS inv_type;
DROP TYPE IF EXISTS je_status;
