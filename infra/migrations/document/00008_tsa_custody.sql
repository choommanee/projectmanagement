-- +goose Up

-- Trust layer (commercial launch hardening):
--
-- 1. RFC 3161 trusted timestamping: each signature row can carry a DER
--    TimeStampToken from a TSA (default freetsa.org, TSA_URL override) proving
--    the chained_hash existed at tsa_time. timestamp_source records provenance:
--    'local' (server clock only — TSA unreachable or disabled) or 'rfc3161'.
--
-- 2. Key custody hardening: document_sign_key gains envelope-encryption
--    metadata. enc_alg='plaintext' marks legacy keys (private_key is raw
--    base64); 'aes256gcm' marks keys whose private_key column holds the
--    base64 AES-256-GCM ciphertext sealed with a per-key DEK derived from
--    SIGN_KEY_MASTER_KEY (HKDF-SHA256, salt=kid). enc_nonce is the GCM nonce.
--
-- 3. Platform X.509 certificate for PAdES-style signed certificate PDFs:
--    document_cert_key stores a self-signed ECDSA P-256 certificate + private
--    key (same enc_alg/enc_nonce custody scheme). Platform-level, NOT
--    tenant-scoped (same posture as document_sign_key — no tenant_id, no RLS).

ALTER TABLE document_signature ADD COLUMN tsa_token bytea;
ALTER TABLE document_signature ADD COLUMN tsa_time timestamptz;
ALTER TABLE document_signature ADD COLUMN timestamp_source text NOT NULL DEFAULT 'local';

ALTER TABLE document_sign_key ADD COLUMN enc_alg text NOT NULL DEFAULT 'plaintext';
ALTER TABLE document_sign_key ADD COLUMN enc_nonce bytea;

CREATE TABLE document_cert_key (
    kid         text PRIMARY KEY,
    cert_pem    text NOT NULL,            -- self-signed X.509 certificate (PEM)
    private_key text NOT NULL,            -- base64 PKCS#8 ECDSA P-256 key (or AES-GCM ciphertext)
    enc_alg     text NOT NULL DEFAULT 'plaintext',
    enc_nonce   bytea,
    active      boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doc_cert_key_active_idx ON document_cert_key(active, created_at);

-- +goose Down

DROP TABLE IF EXISTS document_cert_key;

ALTER TABLE document_sign_key DROP COLUMN IF EXISTS enc_nonce;
ALTER TABLE document_sign_key DROP COLUMN IF EXISTS enc_alg;

ALTER TABLE document_signature DROP COLUMN IF EXISTS timestamp_source;
ALTER TABLE document_signature DROP COLUMN IF EXISTS tsa_time;
ALTER TABLE document_signature DROP COLUMN IF EXISTS tsa_token;
