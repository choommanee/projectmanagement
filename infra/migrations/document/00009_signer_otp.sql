-- +goose Up

-- Email-OTP step-up for e-signature signers (DocuSign-style):
--
-- 1. document_sign_otp: one row per issued challenge. The 6-digit code is
--    never stored — only SHA-256(code || salt) with a per-row random salt.
--    A challenge is "open" while consumed_at IS NULL, not expired, and
--    attempts < 5. Requesting a new code invalidates prior open challenges
--    for the signer.
--
-- 2. document_signature.auth_evidence: jsonb proof of HOW the signer's
--    identity was verified at signing time, e.g.
--    {"method":"email_otp","challenge_id":"...","verified_at":"..."}.
--    NULL for signers that did not use step-up auth.
--
-- 3. document_sign_event.event_type gains 'otp_requested' / 'otp_verified'
--    so OTP ceremony steps ride the tamper-evident audit hash chain.

CREATE TABLE document_sign_otp (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    envelope_id uuid NOT NULL REFERENCES document_sign_envelope(id) ON DELETE CASCADE,
    -- signer_id is the document_signature ROW id (not the user uuid)
    signer_id   uuid NOT NULL REFERENCES document_signature(id) ON DELETE CASCADE,
    code_hash   text NOT NULL,
    salt        text NOT NULL,
    expires_at  timestamptz NOT NULL,
    attempts    int  NOT NULL DEFAULT 0,
    consumed_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doc_sign_otp_tenant_signer_idx ON document_sign_otp(tenant_id, signer_id, created_at);
ALTER TABLE document_sign_otp ENABLE ROW LEVEL SECURITY;
CREATE POLICY doc_sign_otp_tenant_isolation ON document_sign_otp
    USING (tenant_id = current_tenant_uuid());

ALTER TABLE document_signature ADD COLUMN auth_evidence jsonb;

ALTER TABLE document_sign_event DROP CONSTRAINT document_sign_event_event_type_check;
ALTER TABLE document_sign_event ADD CONSTRAINT document_sign_event_event_type_check
    CHECK (event_type IN ('viewed','consented','signed','declined','sent','reminder','completed','voided',
                          'otp_requested','otp_verified'));

-- +goose Down

ALTER TABLE document_sign_event DROP CONSTRAINT document_sign_event_event_type_check;
-- OTP audit rows would violate the restored constraint — remove them first.
DELETE FROM document_sign_event WHERE event_type IN ('otp_requested','otp_verified');
ALTER TABLE document_sign_event ADD CONSTRAINT document_sign_event_event_type_check
    CHECK (event_type IN ('viewed','consented','signed','declined','sent','reminder','completed','voided'));

ALTER TABLE document_signature DROP COLUMN IF EXISTS auth_evidence;

DROP TABLE IF EXISTS document_sign_otp;
