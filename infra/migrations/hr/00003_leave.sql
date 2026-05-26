-- +goose Up
CREATE TYPE leave_type AS ENUM ('annual','sick','maternity','paternity','unpaid','other');
CREATE TYPE leave_status AS ENUM ('pending','approved','rejected','cancelled');

CREATE TABLE leave_request (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  leave_type   leave_type NOT NULL DEFAULT 'annual',
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  days         int NOT NULL GENERATED ALWAYS AS (end_date - start_date + 1) STORED,
  reason       text,
  status       leave_status NOT NULL DEFAULT 'pending',
  approved_by  uuid,
  approved_at  timestamptz,
  rejected_reason text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE leave_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY leave_request_tenant ON leave_request USING (tenant_id = current_tenant_uuid());
CREATE INDEX leave_request_tenant_emp_idx ON leave_request(tenant_id, employee_id);
CREATE INDEX leave_request_tenant_status_idx ON leave_request(tenant_id, status);

-- +goose Down
DROP TABLE IF EXISTS leave_request;
DROP TYPE IF EXISTS leave_status;
DROP TYPE IF EXISTS leave_type;
