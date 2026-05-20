-- +goose Up
CREATE TYPE workflow_status   AS ENUM ('draft','published','archived');
CREATE TYPE wf_inst_status    AS ENUM ('running','paused','completed','failed','cancelled');
CREATE TYPE wf_step_status    AS ENUM ('running','completed','failed','skipped');
CREATE TYPE wf_trigger_kind   AS ENUM ('event','manual','schedule','webhook','record');

CREATE TABLE workflow_definition (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    trigger         JSONB NOT NULL DEFAULT '{"type":"manual"}'::jsonb,
    status          workflow_status NOT NULL DEFAULT 'draft',
    current_version INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ,
    version         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX wf_def_tenant_status_idx ON workflow_definition(tenant_id, status) WHERE deleted_at IS NULL;

CREATE TABLE workflow_version (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    definition_id   UUID NOT NULL REFERENCES workflow_definition(id) ON DELETE CASCADE,
    rev             INTEGER NOT NULL,
    dsl             JSONB NOT NULL,
    published_at    TIMESTAMPTZ,
    created_by      UUID,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (definition_id, rev)
);

CREATE TABLE workflow_instance (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    definition_id   UUID NOT NULL REFERENCES workflow_definition(id) ON DELETE CASCADE,
    version_id      UUID NOT NULL REFERENCES workflow_version(id) ON DELETE RESTRICT,
    status          wf_inst_status NOT NULL DEFAULT 'running',
    input           JSONB NOT NULL DEFAULT '{}'::jsonb,
    output          JSONB,
    variables       JSONB NOT NULL DEFAULT '{}'::jsonb,
    cursor          TEXT,
    error           TEXT,
    trigger_kind    wf_trigger_kind NOT NULL DEFAULT 'manual',
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at        TIMESTAMPTZ
);
CREATE INDEX wf_inst_status_idx ON workflow_instance(tenant_id, status);
CREATE INDEX wf_inst_def_idx    ON workflow_instance(tenant_id, definition_id);

CREATE TABLE step_execution (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    instance_id     UUID NOT NULL REFERENCES workflow_instance(id) ON DELETE CASCADE,
    step_id         TEXT NOT NULL,
    step_type       TEXT NOT NULL,
    status          wf_step_status NOT NULL DEFAULT 'running',
    input           JSONB,
    output          JSONB,
    error           TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at        TIMESTAMPTZ
);
CREATE INDEX step_exec_instance_idx ON step_execution(instance_id, started_at);

CREATE TABLE human_task (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    instance_id     UUID NOT NULL REFERENCES workflow_instance(id) ON DELETE CASCADE,
    step_id         TEXT NOT NULL,
    assignee_id     UUID,
    form            JSONB NOT NULL DEFAULT '{}'::jsonb,
    data            JSONB,
    outcome         TEXT,
    sla_deadline    TIMESTAMPTZ,
    escalate_to     UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);
CREATE INDEX human_task_assignee_idx ON human_task(tenant_id, assignee_id) WHERE completed_at IS NULL;
CREATE INDEX human_task_instance_idx ON human_task(instance_id);

ALTER TABLE workflow_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_version    ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_instance   ENABLE ROW LEVEL SECURITY;
ALTER TABLE step_execution      ENABLE ROW LEVEL SECURITY;
ALTER TABLE human_task          ENABLE ROW LEVEL SECURITY;
CREATE POLICY wf_def_iso     ON workflow_definition USING (tenant_id = current_tenant_uuid());
CREATE POLICY wf_ver_iso     ON workflow_version    USING (tenant_id = current_tenant_uuid());
CREATE POLICY wf_inst_iso    ON workflow_instance   USING (tenant_id = current_tenant_uuid());
CREATE POLICY step_exec_iso  ON step_execution      USING (tenant_id = current_tenant_uuid());
CREATE POLICY human_task_iso ON human_task          USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE human_task;
DROP TABLE step_execution;
DROP TABLE workflow_instance;
DROP TABLE workflow_version;
DROP TABLE workflow_definition;
DROP TYPE wf_trigger_kind;
DROP TYPE wf_step_status;
DROP TYPE wf_inst_status;
DROP TYPE workflow_status;
