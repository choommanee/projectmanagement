-- +goose Up
CREATE TYPE apqp_phase  AS ENUM ('concept','design','process','validation','production','feedback');
CREATE TYPE apqp_status AS ENUM ('not_started','in_progress','complete','blocked');

CREATE TABLE apqp_project (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    item_id       UUID REFERENCES item(id) ON DELETE SET NULL,
    work_order_id UUID REFERENCES work_order(id) ON DELETE SET NULL,
    name          TEXT NOT NULL,
    phase         apqp_phase  NOT NULL DEFAULT 'concept',
    status        apqp_status NOT NULL DEFAULT 'not_started',
    milestones    JSONB NOT NULL DEFAULT '[]'::jsonb,
    owner_id      UUID,
    target_date   DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    version       INTEGER NOT NULL DEFAULT 1
);

CREATE TYPE ppap_status AS ENUM ('draft','submitted','approved','rejected','interim');
CREATE TYPE ppap_element_status AS ENUM ('not_required','in_progress','complete','not_applicable');

CREATE TABLE ppap_submission (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    item_id      UUID NOT NULL REFERENCES item(id) ON DELETE RESTRICT,
    part_no      TEXT NOT NULL,
    customer     TEXT,
    level        INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
    status       ppap_status NOT NULL DEFAULT 'draft',
    submitted_at TIMESTAMPTZ,
    decision_at  TIMESTAMPTZ,
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    version      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE ppap_element (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    submission_id   UUID NOT NULL REFERENCES ppap_submission(id) ON DELETE CASCADE,
    element_no      INTEGER NOT NULL CHECK (element_no BETWEEN 1 AND 18),
    name            TEXT NOT NULL,
    status          ppap_element_status NOT NULL DEFAULT 'not_required',
    evidence_url    TEXT,
    notes           TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (submission_id, element_no)
);

ALTER TABLE apqp_project    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ppap_submission ENABLE ROW LEVEL SECURITY;
ALTER TABLE ppap_element    ENABLE ROW LEVEL SECURITY;
CREATE POLICY apqp_iso        ON apqp_project    USING (tenant_id = current_tenant_uuid());
CREATE POLICY ppap_iso        ON ppap_submission USING (tenant_id = current_tenant_uuid());
CREATE POLICY ppap_elem_iso   ON ppap_element    USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE ppap_element;
DROP TABLE ppap_submission;
DROP TYPE ppap_element_status;
DROP TYPE ppap_status;
DROP TABLE apqp_project;
DROP TYPE apqp_status;
DROP TYPE apqp_phase;
