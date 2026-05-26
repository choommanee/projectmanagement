-- +goose Up

CREATE TABLE department (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code        text NOT NULL,
    name        text NOT NULL,
    parent_id   uuid REFERENCES department(id),
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    version     int NOT NULL DEFAULT 1,
    UNIQUE(tenant_id, code)
);
ALTER TABLE department ENABLE ROW LEVEL SECURITY;
CREATE POLICY dept_iso ON department USING (tenant_id = current_tenant_uuid());
CREATE INDEX dept_tenant_idx ON department(tenant_id, code);

CREATE TABLE position (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    code        text NOT NULL,
    name        text NOT NULL,
    grade       text NOT NULL DEFAULT '',
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    version     int NOT NULL DEFAULT 1,
    UNIQUE(tenant_id, code)
);
ALTER TABLE position ENABLE ROW LEVEL SECURITY;
CREATE POLICY pos_iso ON position USING (tenant_id = current_tenant_uuid());
CREATE INDEX pos_tenant_idx ON position(tenant_id, code);

CREATE TYPE emp_status AS ENUM ('active','probation','resigned','terminated');

CREATE TABLE employee (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    emp_no          text NOT NULL,
    first_name      text NOT NULL,
    last_name       text NOT NULL,
    email           text NOT NULL DEFAULT '',
    phone           text NOT NULL DEFAULT '',
    department_id   uuid REFERENCES department(id),
    position_id     uuid REFERENCES position(id),
    status          emp_status NOT NULL DEFAULT 'active',
    hire_date       date NOT NULL DEFAULT CURRENT_DATE,
    termination_date date,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    version         int NOT NULL DEFAULT 1,
    UNIQUE(tenant_id, emp_no)
);
ALTER TABLE employee ENABLE ROW LEVEL SECURITY;
CREATE POLICY emp_iso ON employee USING (tenant_id = current_tenant_uuid());
CREATE INDEX emp_tenant_idx ON employee(tenant_id, emp_no);
CREATE INDEX emp_dept_idx ON employee(tenant_id, department_id);

-- +goose Down
DROP TABLE IF EXISTS employee;
DROP TABLE IF EXISTS position;
DROP TABLE IF EXISTS department;
DROP TYPE IF EXISTS emp_status;
