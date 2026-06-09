-- +goose Up

-- Operator-provided document-signing certificates (BYO X.509):
--
-- document_cert_key.cert_pem holds the LEAF certificate (PEM). When an operator
-- imports a CA-issued cert, the intermediate CA chain (everything between the
-- leaf and the root) is stored here so SignPDF can embed the full path and an
-- external validator can build trust to the operator's CA. chain_pem is a
-- concatenation of one or more PEM CERTIFICATE blocks in leaf->root order
-- (intermediates only; the leaf stays in cert_pem, the root is omitted by
-- convention since validators supply their own trust anchor). NULL for the
-- legacy self-signed identity, which has no chain.

ALTER TABLE document_cert_key ADD COLUMN chain_pem text;

-- +goose Down

ALTER TABLE document_cert_key DROP COLUMN IF EXISTS chain_pem;
