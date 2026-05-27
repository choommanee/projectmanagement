-- +goose Up

CREATE TYPE training_status AS ENUM ('planned','active','completed','cancelled');
CREATE TABLE training (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    trainer text NOT NULL DEFAULT '',
    location text NOT NULL DEFAULT '',
    start_date date,
    end_date date,
    status training_status NOT NULL DEFAULT 'planned',
    max_participants int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE training ENABLE ROW LEVEL SECURITY;
CREATE POLICY training_tenant ON training USING (tenant_id = current_tenant_uuid());

CREATE TABLE training_participant (
    training_id uuid NOT NULL REFERENCES training(id) ON DELETE CASCADE,
    employee_id uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
    attended bool NOT NULL DEFAULT false,
    score numeric(5,2),
    PRIMARY KEY (training_id, employee_id)
);
ALTER TABLE training_participant ENABLE ROW LEVEL SECURITY;
CREATE POLICY training_participant_tenant ON training_participant
    USING (training_id IN (SELECT id FROM training WHERE tenant_id = current_tenant_uuid()));

CREATE TYPE job_status AS ENUM ('draft','open','closed','cancelled');
CREATE TABLE job_posting (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    title text NOT NULL,
    department_id uuid REFERENCES department(id),
    description text NOT NULL DEFAULT '',
    requirements text NOT NULL DEFAULT '',
    salary_min numeric(12,2),
    salary_max numeric(12,2),
    status job_status NOT NULL DEFAULT 'draft',
    posted_date date,
    closes_date date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE job_posting ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_posting_tenant ON job_posting USING (tenant_id = current_tenant_uuid());

CREATE TYPE applicant_status AS ENUM ('applied','screening','interview','offer','hired','rejected');
CREATE TABLE applicant (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    job_id uuid NOT NULL REFERENCES job_posting(id) ON DELETE CASCADE,
    name text NOT NULL,
    email text NOT NULL DEFAULT '',
    phone text NOT NULL DEFAULT '',
    status applicant_status NOT NULL DEFAULT 'applied',
    resume_url text NOT NULL DEFAULT '',
    notes text NOT NULL DEFAULT '',
    applied_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE applicant ENABLE ROW LEVEL SECURITY;
CREATE POLICY applicant_tenant ON applicant USING (tenant_id = current_tenant_uuid());

CREATE TYPE review_status AS ENUM ('draft','self_review','manager_review','completed');
CREATE TABLE performance_review (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    employee_id uuid NOT NULL REFERENCES employee(id),
    review_period text NOT NULL,
    status review_status NOT NULL DEFAULT 'draft',
    overall_rating smallint,
    self_comments text NOT NULL DEFAULT '',
    manager_comments text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE performance_review ENABLE ROW LEVEL SECURITY;
CREATE POLICY performance_review_tenant ON performance_review USING (tenant_id = current_tenant_uuid());

CREATE TYPE payrun_status AS ENUM ('draft','processing','completed','cancelled');
CREATE TABLE payroll_run (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    period text NOT NULL,
    status payrun_status NOT NULL DEFAULT 'draft',
    total_gross numeric(14,2) NOT NULL DEFAULT 0,
    total_deductions numeric(14,2) NOT NULL DEFAULT 0,
    total_net numeric(14,2) NOT NULL DEFAULT 0,
    employee_count int NOT NULL DEFAULT 0,
    processed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE payroll_run ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_run_tenant ON payroll_run USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE IF EXISTS payroll_run;
DROP TABLE IF EXISTS performance_review;
DROP TABLE IF EXISTS applicant;
DROP TABLE IF EXISTS job_posting;
DROP TABLE IF EXISTS training_participant;
DROP TABLE IF EXISTS training;
DROP TYPE IF EXISTS payrun_status;
DROP TYPE IF EXISTS review_status;
DROP TYPE IF EXISTS applicant_status;
DROP TYPE IF EXISTS job_status;
DROP TYPE IF EXISTS training_status;
