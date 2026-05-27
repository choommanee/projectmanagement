-- +goose Up

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

-- +goose Down
DROP TABLE IF EXISTS document_signature;
