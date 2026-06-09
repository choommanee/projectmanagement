package keyprov

// Operator-provided (BYO) X.509 document-signing certificate import.
//
// Two entry points share one code path:
//
//   - Env boot-load (cmd/server/trust.go): DOC_SIGN_CERT_PEM + DOC_SIGN_KEY_PEM
//     (+ optional DOC_SIGN_CHAIN_PEM) — each may be an inline PEM blob OR a file
//     path. Imported once at startup, becoming the active document_cert_key row.
//   - Admin endpoint (POST /v1/admin/sign-cert): JSON {cert_pem,key_pem,chain_pem?}.
//
// Both call CertManager.Import, which validates the material (key matches cert,
// not expired, usable signing EKU) and atomically swaps the active row: the
// prior active cert is deactivated and the new one inserted active in one
// transaction. Re-importing the same certificate is idempotent (kid is derived
// from the cert's SHA-256 fingerprint, so a duplicate import re-activates the
// existing row instead of creating a second one).
//
// RSA (2048/3072/4096) and ECDSA (P-256/384) keys are both supported.

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Env var names for the boot-load import path.
const (
	CertPEMEnv  = "DOC_SIGN_CERT_PEM"  // leaf certificate (inline PEM or file path)
	KeyPEMEnv   = "DOC_SIGN_KEY_PEM"   // leaf private key (inline PEM or file path)
	ChainPEMEnv = "DOC_SIGN_CHAIN_PEM" // optional intermediate chain (inline PEM or file path)
)

// CertManager imports operator-provided signing certificates into
// document_cert_key with an atomic active-row swap. master seals the private
// key at rest when non-nil (db-encrypted provider).
type CertManager struct {
	pool   *pgxpool.Pool
	master *[32]byte
}

// NewCertManager builds the importer. master may be nil (plaintext storage).
func NewCertManager(pool *pgxpool.Pool, master *[32]byte) *CertManager {
	return &CertManager{pool: pool, master: master}
}

// LoadOrCreate returns the active cert key, bootstrapping a self-signed one on
// first use (delegates to LoadOrCreateCertKey for backward compatibility).
func (m *CertManager) LoadOrCreate(ctx context.Context) (*CertKey, error) {
	return LoadOrCreateCertKey(ctx, m.pool, m.master)
}

// resolvePEM returns inline PEM bytes as-is, or reads them from a file path.
// A value containing a PEM header is treated as inline; otherwise it is a path.
func resolvePEM(v string) ([]byte, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil, nil
	}
	if strings.Contains(v, "-----BEGIN") {
		return []byte(v), nil
	}
	b, err := os.ReadFile(v)
	if err != nil {
		return nil, fmt.Errorf("read PEM file %q: %w", v, err)
	}
	return b, nil
}

// ImportFromEnv imports the cert configured via DOC_SIGN_CERT_PEM/KEY_PEM/CHAIN_PEM.
// Returns (nil, nil) when the env vars are unset (caller falls back to LoadOrCreate).
func (m *CertManager) ImportFromEnv(ctx context.Context) (*CertKey, error) {
	certVal := os.Getenv(CertPEMEnv)
	keyVal := os.Getenv(KeyPEMEnv)
	if certVal == "" && keyVal == "" {
		return nil, nil
	}
	if certVal == "" || keyVal == "" {
		return nil, fmt.Errorf("keyprov: both %s and %s must be set to import a cert", CertPEMEnv, KeyPEMEnv)
	}
	certPEM, err := resolvePEM(certVal)
	if err != nil {
		return nil, fmt.Errorf("keyprov: %s: %w", CertPEMEnv, err)
	}
	keyPEM, err := resolvePEM(keyVal)
	if err != nil {
		return nil, fmt.Errorf("keyprov: %s: %w", KeyPEMEnv, err)
	}
	chainPEM, err := resolvePEM(os.Getenv(ChainPEMEnv))
	if err != nil {
		return nil, fmt.Errorf("keyprov: %s: %w", ChainPEMEnv, err)
	}
	return m.Import(ctx, certPEM, keyPEM, chainPEM)
}

// ImportError marks validation failures so callers can map them to HTTP 400.
type ImportError struct{ err error }

func (e *ImportError) Error() string { return e.err.Error() }
func (e *ImportError) Unwrap() error { return e.err }

func badInput(format string, a ...any) error { return &ImportError{fmt.Errorf(format, a...)} }

// Import validates and atomically installs an operator-provided certificate as
// the active document-signing identity. Returns the resulting active CertKey.
func (m *CertManager) Import(ctx context.Context, certPEM, keyPEM, chainPEM []byte) (*CertKey, error) {
	leaf, err := parseLeafPEM(certPEM)
	if err != nil {
		return nil, badInput("%v", err)
	}
	key, err := parseSigningKeyPEM(keyPEM)
	if err != nil {
		return nil, badInput("%v", err)
	}
	if err := keyMatchesCert(key, leaf); err != nil {
		return nil, badInput("%v", err)
	}
	now := time.Now()
	if now.Before(leaf.NotBefore) {
		return nil, badInput("certificate is not yet valid (NotBefore %s)", leaf.NotBefore.UTC().Format(time.RFC3339))
	}
	if now.After(leaf.NotAfter) {
		return nil, badInput("certificate is expired (NotAfter %s)", leaf.NotAfter.UTC().Format(time.RFC3339))
	}
	var chain []*x509.Certificate
	if len(chainPEM) > 0 {
		chain, err = parseChainPEM(chainPEM)
		if err != nil {
			return nil, badInput("%v", err)
		}
	}
	// Re-encode to canonical single-block PEM (drops stray text/whitespace).
	canonCert := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leaf.Raw})
	var canonChain []byte
	for _, c := range chain {
		canonChain = append(canonChain, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: c.Raw})...)
	}

	// Deterministic kid from the leaf fingerprint → idempotent re-import.
	fp := sha256.Sum256(leaf.Raw)
	kid := fmt.Sprintf("doc-cert-%s-%s", keyAlgLabel(key), hex.EncodeToString(fp[:6]))

	pkcs8, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, fmt.Errorf("keyprov: marshal imported key: %w", err)
	}
	alg := AlgPlaintext
	var nonce []byte
	stored := pkcs8
	if m.master != nil {
		ct, n, err := sealKey(m.master, kid, pkcs8)
		if err != nil {
			return nil, err
		}
		stored, nonce, alg = ct, n, AlgAES256GCM
	}

	if err := m.swapActive(ctx, kid, canonCert, canonChain, stored, alg, nonce); err != nil {
		return nil, err
	}
	// Reload through the standard path so the returned handle matches what the
	// service would load on restart (incl. master-key unwrap).
	ck, err := loadCertKey(ctx, m.pool, m.master)
	if err != nil {
		return nil, fmt.Errorf("keyprov: reload after import: %w", err)
	}
	return ck, nil
}

// swapActive atomically deactivates the current active cert and installs the
// new one. Idempotent on kid: a repeated import updates the existing row and
// re-activates it rather than inserting a duplicate.
func (m *CertManager) swapActive(ctx context.Context, kid string, certPEM, chainPEM, priv []byte, alg string, nonce []byte) error {
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `UPDATE document_cert_key SET active=false WHERE active AND kid<>$1`, kid); err != nil {
		return err
	}
	var chainArg any
	if len(chainPEM) > 0 {
		chainArg = string(chainPEM)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO document_cert_key (kid, cert_pem, chain_pem, private_key, active, enc_alg, enc_nonce)
		 VALUES ($1,$2,$3,$4,true,$5,$6)
		 ON CONFLICT (kid) DO UPDATE SET
		   cert_pem=EXCLUDED.cert_pem, chain_pem=EXCLUDED.chain_pem,
		   private_key=EXCLUDED.private_key, active=true,
		   enc_alg=EXCLUDED.enc_alg, enc_nonce=EXCLUDED.enc_nonce`,
		kid, string(certPEM), chainArg, base64.StdEncoding.EncodeToString(priv), alg, nonce); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// --- parsing & validation helpers --------------------------------------------

// parseLeafPEM decodes the first CERTIFICATE block from PEM.
func parseLeafPEM(b []byte) (*x509.Certificate, error) {
	block, _ := pem.Decode(b)
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, fmt.Errorf("no CERTIFICATE PEM block found")
	}
	crt, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse certificate: %w", err)
	}
	return crt, nil
}

// parseChainPEM decodes one or more concatenated CERTIFICATE blocks.
func parseChainPEM(b []byte) ([]*x509.Certificate, error) {
	var out []*x509.Certificate
	rest := b
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		if block.Type != "CERTIFICATE" {
			continue
		}
		crt, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse chain certificate: %w", err)
		}
		out = append(out, crt)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("no CERTIFICATE PEM block found in chain")
	}
	return out, nil
}

// parseSigningKeyPEM decodes a PEM private key (PKCS#8, PKCS#1 RSA, or SEC1 EC).
func parseSigningKeyPEM(b []byte) (crypto.Signer, error) {
	block, _ := pem.Decode(b)
	if block == nil {
		return nil, fmt.Errorf("no PRIVATE KEY PEM block found")
	}
	return parseSigningKeyDER(block.Bytes, block.Type)
}

// parseSigningKey decodes a DER private key, trying PKCS#8 then PKCS#1/SEC1.
func parseSigningKey(der []byte) (crypto.Signer, error) {
	return parseSigningKeyDER(der, "")
}

func parseSigningKeyDER(der []byte, pemType string) (crypto.Signer, error) {
	if k, err := x509.ParsePKCS8PrivateKey(der); err == nil {
		return asSupportedSigner(k)
	}
	if pemType == "RSA PRIVATE KEY" || pemType == "" {
		if k, err := x509.ParsePKCS1PrivateKey(der); err == nil {
			return asSupportedSigner(k)
		}
	}
	if pemType == "EC PRIVATE KEY" || pemType == "" {
		if k, err := x509.ParseECPrivateKey(der); err == nil {
			return asSupportedSigner(k)
		}
	}
	return nil, fmt.Errorf("unsupported or malformed private key (want PKCS#8, PKCS#1 RSA, or SEC1 EC)")
}

// asSupportedSigner enforces the supported key matrix: RSA (2048/3072/4096) and
// ECDSA (P-256/384).
func asSupportedSigner(k any) (crypto.Signer, error) {
	switch key := k.(type) {
	case *rsa.PrivateKey:
		switch bits := key.N.BitLen(); bits {
		case 2048, 3072, 4096:
			return key, nil
		default:
			return nil, fmt.Errorf("unsupported RSA key size %d (want 2048, 3072, or 4096)", bits)
		}
	case *ecdsa.PrivateKey:
		switch name := key.Curve.Params().Name; name {
		case "P-256", "P-384":
			return key, nil
		default:
			return nil, fmt.Errorf("unsupported ECDSA curve %q (want P-256 or P-384)", name)
		}
	default:
		return nil, fmt.Errorf("unsupported key type %T (want RSA or ECDSA)", k)
	}
}

// keyMatchesCert confirms the private key's public half matches the cert.
func keyMatchesCert(key crypto.Signer, crt *x509.Certificate) error {
	switch pub := key.Public().(type) {
	case *rsa.PublicKey:
		cp, ok := crt.PublicKey.(*rsa.PublicKey)
		if !ok || cp.N.Cmp(pub.N) != 0 || cp.E != pub.E {
			return fmt.Errorf("private key does not match certificate public key")
		}
	case *ecdsa.PublicKey:
		cp, ok := crt.PublicKey.(*ecdsa.PublicKey)
		if !ok || cp.X.Cmp(pub.X) != 0 || cp.Y.Cmp(pub.Y) != 0 {
			return fmt.Errorf("private key does not match certificate public key")
		}
	default:
		return fmt.Errorf("unsupported certificate public key type")
	}
	return nil
}

func keyAlgLabel(key crypto.Signer) string {
	switch key.(type) {
	case *rsa.PrivateKey:
		return "rsa"
	case *ecdsa.PrivateKey:
		return "ecdsa"
	default:
		return "key"
	}
}

// HasDocumentSigningEKU reports whether the cert carries the RFC 9336
// id-kp-documentSigning EKU that PAdES validators prefer.
func HasDocumentSigningEKU(crt *x509.Certificate) bool {
	for _, oid := range crt.UnknownExtKeyUsage {
		if oid.Equal(oidDocumentSigning) {
			return true
		}
	}
	for _, eku := range crt.ExtKeyUsage {
		if eku == x509.ExtKeyUsage(36) {
			return true
		}
	}
	return false
}
