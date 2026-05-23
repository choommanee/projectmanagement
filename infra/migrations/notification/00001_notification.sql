-- +goose Up
CREATE TABLE notification (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL,
    kind        TEXT NOT NULL,
    title       TEXT NOT NULL,
    body        TEXT,
    payload     JSONB,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notification_tenant_user_created_idx
    ON notification(tenant_id, user_id, created_at DESC);
CREATE INDEX notification_tenant_user_unread_idx
    ON notification(tenant_id, user_id, created_at DESC)
    WHERE read_at IS NULL;

ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_tenant_isolation
    ON notification USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE notification;
