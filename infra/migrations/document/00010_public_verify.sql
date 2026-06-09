-- +goose Up

-- Public verification links (Team F — external validity reports):
--
-- An authorized tenant user mints a share link for a signing envelope. The
-- RAW 256-bit url-safe token is returned exactly once at creation; only its
-- SHA-256 hex digest is stored here (token_hash), so a DB leak does not leak
-- usable links. An external party (no account, no tenant context) opens
-- GET /public/verify/{token} and receives a safe validity report.
--
-- RLS DECISION (deliberate, documented exception):
-- This table keeps the standard tenant posture (tenant_id NOT NULL + FK +
-- tenant-isolation policy + (tenant_id, ...) index), BUT the public lookup
-- happens with NO tenant GUC set — an anonymous caller cannot know the
-- tenant. We combine the two patterns from the design note:
--   (a) a second permissive SELECT policy permits row visibility ONLY when
--       no tenant context is set (current_tenant_uuid() IS NULL). The store's
--       public resolver selects by token_hash (unique, 256-bit preimage), so
--       the no-tenant path cannot enumerate anything it does not already
--       hold a token for; and
--   (b) the store (internal/store/publiclink.go ResolveByTokenHash) resolves
--       token_hash -> (tenant_id, envelope_id) WITHOUT the GUC, then all
--       subsequent envelope/event/certificate reads run through the normal
--       SET LOCAL app.current_tenant = <resolved tenant> transactions, so
--       RLS on every OTHER table is fully enforced and untouched.
-- No other table's RLS is weakened.

CREATE TABLE document_verify_link (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    envelope_id      uuid NOT NULL REFERENCES document_sign_envelope(id) ON DELETE CASCADE,
    token_hash       text NOT NULL UNIQUE,  -- SHA-256 hex of the raw token; raw token is never stored
    created_by       uuid,
    created_at       timestamptz NOT NULL DEFAULT now(),
    expires_at       timestamptz,           -- NULL = no expiry
    revoked_at       timestamptz,
    access_count     int NOT NULL DEFAULT 0,
    last_accessed_at timestamptz
);
CREATE INDEX doc_verify_link_tenant_env_idx ON document_verify_link(tenant_id, envelope_id);

ALTER TABLE document_verify_link ENABLE ROW LEVEL SECURITY;
CREATE POLICY doc_verify_link_tenant_isolation ON document_verify_link
    USING (tenant_id = current_tenant_uuid());
-- Public-resolution exception: SELECT-only, and ONLY when no tenant context
-- is set (the anonymous /public/verify path). Authenticated tenant sessions
-- always carry the GUC and therefore use the isolation policy above.
CREATE POLICY doc_verify_link_public_lookup ON document_verify_link
    FOR SELECT USING (current_tenant_uuid() IS NULL);

-- Audit-trail event kinds for the verify-link lifecycle (extends the set the
-- same way 00009 added otp_*). Events ride the existing tamper-evident
-- event hash chain in document_sign_event.
ALTER TABLE document_sign_event DROP CONSTRAINT document_sign_event_event_type_check;
ALTER TABLE document_sign_event ADD CONSTRAINT document_sign_event_event_type_check
    CHECK (event_type IN ('viewed','consented','signed','declined','sent','reminder','completed','voided',
                          'otp_requested','otp_verified',
                          'verify_link_created','verify_link_accessed','verify_link_revoked'));

-- +goose Down

ALTER TABLE document_sign_event DROP CONSTRAINT document_sign_event_event_type_check;
-- rows carrying the new kinds must go before the narrower check returns
DELETE FROM document_sign_event WHERE event_type IN ('verify_link_created','verify_link_accessed','verify_link_revoked');
ALTER TABLE document_sign_event ADD CONSTRAINT document_sign_event_event_type_check
    CHECK (event_type IN ('viewed','consented','signed','declined','sent','reminder','completed','voided',
                          'otp_requested','otp_verified'));

DROP TABLE IF EXISTS document_verify_link;
