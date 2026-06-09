package keyprov

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CertKey is the platform X.509 document-signing identity used to embed a
// PAdES-style signature into the Certificate of Completion PDF. By default the
// certificate is self-signed (CN "PM Platform Document Signing", 10y); an
// external validator (e.g. Adobe Reader) will show the signature as
// cryptographically intact but from an untrusted issuer until the cert is
// imported into its trust store. An operator MAY instead import their own
// CA-issued X.509 cert (RSA 2048/3072/4096 or ECDSA P-256/384) via the env
// boot-load path or the POST /v1/admin/sign-cert endpoint — see import.go.
type CertKey struct {
	KID string
	// Key is the leaf private key. It is a crypto.Signer so both ECDSA
	// (self-signed default) and RSA (most CA-issued document-signing certs)
	// keys are supported transparently.
	Key      crypto.Signer
	Cert     *x509.Certificate
	CertPEM  []byte
	Chain    []*x509.Certificate // intermediate CA chain (leaf->root, intermediates only); nil for self-signed
	ChainPEM []byte              // concatenated PEM of Chain (nil when no chain)
}

// oidDocumentSigning is the RFC 9336 id-kp-documentSigning EKU
// (1.3.6.1.5.5.7.3.36) that pdfsign's default verify options require.
var oidDocumentSigning = asn1.ObjectIdentifier{1, 3, 6, 1, 5, 5, 7, 3, 36}

// LoadOrCreateCertKey returns the active platform certificate key from
// document_cert_key, generating a self-signed ECDSA P-256 identity on first
// use. When master is non-nil the private key is sealed with the same
// AES-256-GCM envelope scheme as the record-signing key.
func LoadOrCreateCertKey(ctx context.Context, pool *pgxpool.Pool, master *[32]byte) (*CertKey, error) {
	ck, err := loadCertKey(ctx, pool, master)
	if err == nil {
		return ck, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if err := createCertKey(ctx, pool, master); err != nil {
		return nil, err
	}
	ck, err = loadCertKey(ctx, pool, master)
	if err != nil {
		return nil, fmt.Errorf("keyprov: cert key bootstrap failed: %w", err)
	}
	return ck, nil
}

func loadCertKey(ctx context.Context, pool *pgxpool.Pool, master *[32]byte) (*CertKey, error) {
	var kid, certPEM, privB64, alg string
	var chainPEM *string
	var nonce []byte
	err := pool.QueryRow(ctx,
		`SELECT kid, cert_pem, chain_pem, private_key, enc_alg, enc_nonce FROM document_cert_key
		 WHERE active ORDER BY created_at ASC LIMIT 1`).Scan(&kid, &certPEM, &chainPEM, &privB64, &alg, &nonce)
	if err != nil {
		return nil, err
	}
	raw, err := base64.StdEncoding.DecodeString(privB64)
	if err != nil {
		return nil, fmt.Errorf("keyprov: malformed cert private key for kid %q", kid)
	}
	switch alg {
	case AlgPlaintext:
	case AlgAES256GCM:
		raw, err = openKey(master, kid, raw, nonce)
		if err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("keyprov: unknown enc_alg %q for cert kid %q", alg, kid)
	}
	key, err := parseSigningKey(raw)
	if err != nil {
		return nil, fmt.Errorf("keyprov: parse cert key %q: %w", kid, err)
	}
	crt, err := parseLeafPEM([]byte(certPEM))
	if err != nil {
		return nil, fmt.Errorf("keyprov: %w (kid %q)", err, kid)
	}
	ck := &CertKey{KID: kid, Key: key, Cert: crt, CertPEM: []byte(certPEM)}
	if chainPEM != nil && *chainPEM != "" {
		chain, err := parseChainPEM([]byte(*chainPEM))
		if err != nil {
			return nil, fmt.Errorf("keyprov: parse chain for kid %q: %w", kid, err)
		}
		ck.Chain = chain
		ck.ChainPEM = []byte(*chainPEM)
	}
	return ck, nil
}

func createCertKey(ctx context.Context, pool *pgxpool.Pool, master *[32]byte) error {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	tpl := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName:   "PM Platform Document Signing",
			Organization: []string{"PM Platform"},
		},
		NotBefore:             now.Add(-5 * time.Minute),
		NotAfter:              now.AddDate(10, 0, 0), // 10 years
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageContentCommitment,
		UnknownExtKeyUsage:    []asn1.ObjectIdentifier{oidDocumentSigning},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		return err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})

	pkcs8, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return err
	}
	kid := "doc-cert-ecdsa-" + uuid.NewString()[:8]
	alg := AlgPlaintext
	var nonce []byte
	stored := pkcs8
	if master != nil {
		ct, n, err := sealKey(master, kid, pkcs8)
		if err != nil {
			return err
		}
		stored, nonce, alg = ct, n, AlgAES256GCM
	}
	_, err = pool.Exec(ctx,
		`INSERT INTO document_cert_key (kid, cert_pem, private_key, active, enc_alg, enc_nonce)
		 SELECT $1, $2, $3, true, $4, $5
		 WHERE NOT EXISTS (SELECT 1 FROM document_cert_key WHERE active)`,
		kid, string(certPEM), base64.StdEncoding.EncodeToString(stored), alg, nonce)
	return err
}
