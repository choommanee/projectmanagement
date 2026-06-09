-- +goose Up
-- wake_at supports the wait/timer step and schedule-driven resumes: the
-- workflow-svc poller wakes paused instances whose wake_at has elapsed.
ALTER TABLE workflow_instance ADD COLUMN wake_at TIMESTAMPTZ;

-- Hot-path partial index for the poller: only paused instances with a timer.
CREATE INDEX wf_inst_wake_idx
    ON workflow_instance(wake_at)
    WHERE status = 'paused' AND wake_at IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS wf_inst_wake_idx;
ALTER TABLE workflow_instance DROP COLUMN wake_at;
