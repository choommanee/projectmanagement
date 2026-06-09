-- +goose Up

-- Tier-1 e-signature: signing envelope (a signing request over a document
-- version) with ordered/parallel signers, a tamper-evident hash chain, a
-- full audit trail, and a generated Certificate of Completion (PDF).
--
-- The legacy document_signature table (00005) is REPLACED by signer rows
-- linked to an envelope. We drop and recreate it here so signer rows carry
-- envelope_id, order_index, routing_status, auth_method, and the hash-chain
-- columns. The legacy /v1/documents/{id}/signatures* routes are shimmed in
-- the service layer onto envelopes, so no data-shape compat is required.

DROP TABLE IF EXISTS document_signature;

-- --- Envelope ---------------------------------------------------------------
CREATE TABLE document_sign_envelope (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    document_id   uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    version_id    uuid REFERENCES document_version(id) ON DELETE SET NULL,
    title         text NOT NULL DEFAULT '',
    status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','completed','declined','voided','expired')),
    signing_order text NOT NULL DEFAULT 'sequential'
                  CHECK (signing_order IN ('sequential','parallel')),
    created_by    uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    sent_at       timestamptz,
    completed_at  timestamptz,
    voided_at     timestamptz,
    void_reason   text NOT NULL DEFAULT '',
    expires_at    timestamptz
);
CREATE INDEX doc_sign_env_tenant_doc_idx ON document_sign_envelope(tenant_id, document_id);
CREATE INDEX doc_sign_env_tenant_status_idx ON document_sign_envelope(tenant_id, status);
ALTER TABLE document_sign_envelope ENABLE ROW LEVEL SECURITY;
CREATE POLICY doc_sign_env_tenant_isolation ON document_sign_envelope
    USING (tenant_id = current_tenant_uuid());

-- --- Signer row (replaces document_signature) -------------------------------
CREATE TABLE document_signature (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    envelope_id    uuid NOT NULL REFERENCES document_sign_envelope(id) ON DELETE CASCADE,
    document_id    uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    signer_id      uuid NOT NULL,
    signer_name    text NOT NULL DEFAULT '',
    signer_email   text NOT NULL DEFAULT '',
    order_index    int  NOT NULL DEFAULT 0,
    status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','signed','declined')),
    routing_status text NOT NULL DEFAULT 'waiting'
                   CHECK (routing_status IN ('waiting','active','completed','declined')),
    auth_method    text NOT NULL DEFAULT 'session'
                   CHECK (auth_method IN ('session','email_otp','sso','typed_name')),
    typed_name     text NOT NULL DEFAULT '',
    signature_image bytea,
    consent        boolean NOT NULL DEFAULT false,
    requested_at   timestamptz NOT NULL DEFAULT now(),
    viewed_at      timestamptz,
    signed_at      timestamptz,
    declined_at    timestamptz,
    decline_reason text NOT NULL DEFAULT '',
    -- tamper-evident hash chain captured at signing time
    content_hash   text NOT NULL DEFAULT '',
    prev_hash      text NOT NULL DEFAULT '',
    chained_hash   text NOT NULL DEFAULT '',
    version_id     uuid REFERENCES document_version(id) ON DELETE SET NULL
);
CREATE INDEX doc_sig_envelope_idx ON document_signature(tenant_id, envelope_id, order_index);
CREATE INDEX doc_sig_doc_idx ON document_signature(tenant_id, document_id);
ALTER TABLE document_signature ENABLE ROW LEVEL SECURITY;
CREATE POLICY doc_sig_tenant_isolation ON document_signature
    USING (tenant_id = current_tenant_uuid());

-- --- Audit trail ------------------------------------------------------------
CREATE TABLE document_sign_event (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    envelope_id uuid NOT NULL REFERENCES document_sign_envelope(id) ON DELETE CASCADE,
    signer_id   uuid,
    event_type  text NOT NULL
                CHECK (event_type IN ('viewed','consented','signed','declined','sent','reminder','completed','voided')),
    actor_id    uuid,
    ip_address  text NOT NULL DEFAULT '',
    user_agent  text NOT NULL DEFAULT '',
    geo         text NOT NULL DEFAULT '',
    metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doc_sign_event_env_idx ON document_sign_event(tenant_id, envelope_id, created_at);
ALTER TABLE document_sign_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY doc_sign_event_tenant_isolation ON document_sign_event
    USING (tenant_id = current_tenant_uuid());

-- --- Certificate of Completion (PDF bytes) ----------------------------------
CREATE TABLE document_sign_certificate (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    envelope_id  uuid NOT NULL REFERENCES document_sign_envelope(id) ON DELETE CASCADE,
    document_id  uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    final_hash   text NOT NULL DEFAULT '',
    pdf_bytes    bytea NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, envelope_id)
);
CREATE INDEX doc_sign_cert_env_idx ON document_sign_certificate(tenant_id, envelope_id);
ALTER TABLE document_sign_certificate ENABLE ROW LEVEL SECURITY;
CREATE POLICY doc_sign_cert_tenant_isolation ON document_sign_certificate
    USING (tenant_id = current_tenant_uuid());

-- +goose Down

DROP TABLE IF EXISTS document_sign_certificate;
DROP TABLE IF EXISTS document_sign_event;
DROP TABLE IF EXISTS document_signature;
DROP TABLE IF EXISTS document_sign_envelope;

-- Recreate the legacy 00005 shape so a down-migration is a clean reverse.
CREATE TABLE document_signature (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    document_id    uuid NOT NULL REFERENCES document(id) ON DELETE CASCADE,
    signer_id      uuid NOT NULL,
    signer_email   text NOT NULL DEFAULT '',
    status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed','declined')),
    requested_at   timestamptz NOT NULL DEFAULT now(),
    signed_at      timestamptz,
    declined_at    timestamptz,
    decline_reason text NOT NULL DEFAULT '',
    signature_hash text NOT NULL DEFAULT '',
    version_id     uuid REFERENCES document_version(id) ON DELETE SET NULL
);
CREATE INDEX doc_sig_doc_idx ON document_signature(document_id);
ALTER TABLE document_signature ENABLE ROW LEVEL SECURITY;
CREATE POLICY doc_sig_tenant_isolation ON document_signature
    USING (tenant_id = current_tenant_uuid());
