-- +goose Up
-- pending_envelope_id correlates a paused instance with a document-svc
-- signature envelope. When the engine pauses on a request_signature step it
-- returns pending_signature.envelope_id; we persist it here so the
-- document.sign_completed / document.sign_declined NATS events can find the
-- instance awaiting that envelope and resume it.
ALTER TABLE workflow_instance ADD COLUMN pending_envelope_id UUID;

-- Hot-path partial index: only paused instances actually awaiting a signature.
CREATE INDEX wf_inst_pending_envelope_idx
    ON workflow_instance(pending_envelope_id)
    WHERE status = 'paused' AND pending_envelope_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS wf_inst_pending_envelope_idx;
ALTER TABLE workflow_instance DROP COLUMN pending_envelope_id;
