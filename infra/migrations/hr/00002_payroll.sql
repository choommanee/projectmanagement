-- +goose Up
CREATE TYPE pay_frequency AS ENUM ('monthly','biweekly','weekly');
CREATE TYPE payslip_status AS ENUM ('draft','approved','paid');

CREATE TABLE pay_grade (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  name       text NOT NULL,
  min_salary numeric(15,2) NOT NULL DEFAULT 0,
  max_salary numeric(15,2) NOT NULL DEFAULT 0,
  currency   text NOT NULL DEFAULT 'THB',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pay_grade ENABLE ROW LEVEL SECURITY;
CREATE POLICY pay_grade_tenant ON pay_grade USING (tenant_id = current_tenant_uuid());
CREATE INDEX pay_grade_tenant_idx ON pay_grade(tenant_id);

CREATE TABLE payslip (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end   date NOT NULL,
  base_salary  numeric(15,2) NOT NULL DEFAULT 0,
  allowances   numeric(15,2) NOT NULL DEFAULT 0,
  deductions   numeric(15,2) NOT NULL DEFAULT 0,
  net_pay      numeric(15,2) GENERATED ALWAYS AS (base_salary + allowances - deductions) STORED,
  currency     text NOT NULL DEFAULT 'THB',
  status       payslip_status NOT NULL DEFAULT 'draft',
  approved_by  uuid,
  approved_at  timestamptz,
  paid_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payslip ENABLE ROW LEVEL SECURITY;
CREATE POLICY payslip_tenant ON payslip USING (tenant_id = current_tenant_uuid());
CREATE INDEX payslip_tenant_emp_idx ON payslip(tenant_id, employee_id);
CREATE INDEX payslip_tenant_status_idx ON payslip(tenant_id, status);

-- +goose Down
DROP TABLE IF EXISTS payslip;
DROP TABLE IF EXISTS pay_grade;
DROP TYPE IF EXISTS payslip_status;
DROP TYPE IF EXISTS pay_frequency;
