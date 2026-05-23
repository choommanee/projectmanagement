-- +goose Up
CREATE TABLE notification_preference (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    kind       TEXT NOT NULL,
    channels   TEXT[] NOT NULL DEFAULT '{inapp}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, user_id, kind)
);

CREATE INDEX notification_preference_tenant_user_idx
    ON notification_preference(tenant_id, user_id);

ALTER TABLE notification_preference ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preference FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_preference_tenant_isolation
    ON notification_preference USING (tenant_id = current_tenant_uuid());

-- +goose Down
DROP TABLE notification_preference;
