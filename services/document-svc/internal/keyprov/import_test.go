package keyprov

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/pem"
	"math/big"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// snapshotCertKeys records the current document_cert_key rows + active kid and
// restores them after the test (platform table shared with the dev stack).
func snapshotCertKeys(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	before := map[string]bool{}
	rows, err := p.Query(ctx, `SELECT kid FROM document_cert_key`)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	for rows.Next() {
		var kid string
		_ = rows.Scan(&kid)
		before[kid] = true
	}
	rows.Close()
	var activeBefore string
	_ = p.QueryRow(ctx, `SELECT kid FROM document_cert_key WHERE active ORDER BY created_at ASC LIMIT 1`).Scan(&activeBefore)
	t.Cleanup(func() {
		crows, _ := p.Query(ctx, `SELECT kid FROM document_cert_key`)
		var now []string
		for crows.Next() {
			var kid string
			_ = crows.Scan(&kid)
			now = append(now, kid)
		}
		crows.Close()
		for _, kid := range now {
			if !before[kid] {
				_, _ = p.Exec(ctx, `DELETE FROM document_cert_key WHERE kid=$1`, kid)
			}
		}
		_, _ = p.Exec(ctx, `UPDATE document_cert_key SET active=false`)
		if activeBefore != "" {
			_, _ = p.Exec(ctx, `UPDATE document_cert_key SET active=true WHERE kid=$1`, activeBefore)
		}
	})
}

var testDocSigningEKU = asn1.ObjectIdentifier{1, 3, 6, 1, 5, 5, 7, 3, 36}

// genLeaf returns a PEM cert + PEM PKCS#8 key for a self-signed leaf with the
// documentSigning EKU and digitalSignature KU.
func genLeaf(t *testing.T, cn string, key crypto.Signer) (certPEM, keyPEM []byte) {
	t.Helper()
	tpl := &x509.Certificate{
		SerialNumber:          big.NewInt(time.Now().UnixNano()),
		Subject:               pkix.Name{CommonName: cn, Organization: []string{"Test CA Co"}},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageContentCommitment,
		UnknownExtKeyUsage:    []asn1.ObjectIdentifier{testDocSigningEKU},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, key.Public(), key)
	if err != nil {
		t.Fatal(err)
	}
	certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	pkcs8, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	keyPEM = pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8})
	return certPEM, keyPEM
}

func rsaKey(t *testing.T, bits int) *rsa.PrivateKey {
	t.Helper()
	k, err := rsa.GenerateKey(rand.Reader, bits)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func ecKey(t *testing.T, c elliptic.Curve) *ecdsa.PrivateKey {
	t.Helper()
	k, err := ecdsa.GenerateKey(c, rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func TestImportRSARoundTrip(t *testing.T) {
	p := testPool(t)
	snapshotCertKeys(t, p)
	ctx := context.Background()
	mgr := NewCertManager(p, nil)

	key := rsaKey(t, 3072)
	certPEM, keyPEM := genLeaf(t, "Acme RSA Signer", key)
	ck, err := mgr.Import(ctx, certPEM, keyPEM, nil)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if ck.Cert.Subject.CommonName != "Acme RSA Signer" {
		t.Fatalf("CN = %q", ck.Cert.Subject.CommonName)
	}
	if _, ok := ck.Key.(*rsa.PrivateKey); !ok {
		t.Fatalf("reloaded key type = %T, want *rsa.PrivateKey", ck.Key)
	}
	// Active DB row reflects the import.
	var cn string
	if err := p.QueryRow(ctx, `SELECT kid FROM document_cert_key WHERE active`).Scan(&cn); err != nil {
		t.Fatalf("active row: %v", err)
	}
	if cn != ck.KID {
		t.Fatalf("active kid = %q, want %q", cn, ck.KID)
	}
}

func TestImportECDSARoundTrip(t *testing.T) {
	p := testPool(t)
	snapshotCertKeys(t, p)
	ctx := context.Background()
	mgr := NewCertManager(p, newMaster(t)) // exercise sealed-at-rest path too

	key := ecKey(t, elliptic.P384())
	certPEM, keyPEM := genLeaf(t, "Acme EC Signer", key)
	ck, err := mgr.Import(ctx, certPEM, keyPEM, nil)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if _, ok := ck.Key.(*ecdsa.PrivateKey); !ok {
		t.Fatalf("reloaded key type = %T, want *ecdsa.PrivateKey", ck.Key)
	}
	// Sealed: a wrong master must fail to unwrap.
	if _, err := loadCertKey(ctx, p, newMaster(t)); err == nil {
		t.Fatal("expected unwrap failure with wrong master key")
	}
}

func TestImportKeyCertMismatch(t *testing.T) {
	p := testPool(t)
	snapshotCertKeys(t, p)
	ctx := context.Background()
	mgr := NewCertManager(p, nil)

	certPEM, _ := genLeaf(t, "Mismatch", rsaKey(t, 2048))
	_, otherKeyPEM := genLeaf(t, "Other", rsaKey(t, 2048))
	_, err := mgr.Import(ctx, certPEM, otherKeyPEM, nil)
	if err == nil {
		t.Fatal("expected mismatch error")
	}
	var ie *ImportError
	if !asImportError(err, &ie) {
		t.Fatalf("want *ImportError, got %T: %v", err, err)
	}
}

func TestImportRejectsUnsupportedKeySize(t *testing.T) {
	p := testPool(t)
	snapshotCertKeys(t, p)
	ctx := context.Background()
	mgr := NewCertManager(p, nil)

	key := rsaKey(t, 1024) // unsupported
	certPEM, keyPEM := genLeaf(t, "Weak", key)
	if _, err := mgr.Import(ctx, certPEM, keyPEM, nil); err == nil {
		t.Fatal("expected unsupported key size error")
	}
}

func TestImportRejectsExpired(t *testing.T) {
	p := testPool(t)
	snapshotCertKeys(t, p)
	ctx := context.Background()
	mgr := NewCertManager(p, nil)

	key := rsaKey(t, 2048)
	tpl := &x509.Certificate{
		SerialNumber:          big.NewInt(99),
		Subject:               pkix.Name{CommonName: "Expired"},
		NotBefore:             time.Now().Add(-48 * time.Hour),
		NotAfter:              time.Now().Add(-24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		UnknownExtKeyUsage:    []asn1.ObjectIdentifier{testDocSigningEKU},
		BasicConstraintsValid: true,
	}
	der, _ := x509.CreateCertificate(rand.Reader, tpl, tpl, key.Public(), key)
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	pkcs8, _ := x509.MarshalPKCS8PrivateKey(key)
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8})
	if _, err := mgr.Import(ctx, certPEM, keyPEM, nil); err == nil {
		t.Fatal("expected expired-cert error")
	}
}

func TestImportAtomicSwapAndIdempotent(t *testing.T) {
	p := testPool(t)
	snapshotCertKeys(t, p)
	ctx := context.Background()
	mgr := NewCertManager(p, nil)

	certA, keyA := genLeaf(t, "Cert A", rsaKey(t, 2048))
	certB, keyB := genLeaf(t, "Cert B", ecKey(t, elliptic.P256()))

	ckA, err := mgr.Import(ctx, certA, keyA, nil)
	if err != nil {
		t.Fatalf("import A: %v", err)
	}
	// Idempotent: re-import A → same kid, no duplicate row.
	ckA2, err := mgr.Import(ctx, certA, keyA, nil)
	if err != nil {
		t.Fatalf("re-import A: %v", err)
	}
	if ckA2.KID != ckA.KID {
		t.Fatalf("idempotent kid changed: %q vs %q", ckA2.KID, ckA.KID)
	}
	var nA int
	p.QueryRow(ctx, `SELECT count(*) FROM document_cert_key WHERE kid=$1`, ckA.KID).Scan(&nA)
	if nA != 1 {
		t.Fatalf("duplicate rows for kid %q: %d", ckA.KID, nA)
	}

	// Atomic swap: import B → only B active, A deactivated.
	ckB, err := mgr.Import(ctx, certB, keyB, nil)
	if err != nil {
		t.Fatalf("import B: %v", err)
	}
	if ckB.KID == ckA.KID {
		t.Fatal("expected distinct kid for cert B")
	}
	var activeKid string
	var activeCount int
	p.QueryRow(ctx, `SELECT count(*) FROM document_cert_key WHERE active`).Scan(&activeCount)
	p.QueryRow(ctx, `SELECT kid FROM document_cert_key WHERE active`).Scan(&activeKid)
	if activeCount != 1 || activeKid != ckB.KID {
		t.Fatalf("after swap want exactly active=%q, got count=%d active=%q", ckB.KID, activeCount, activeKid)
	}
}

func TestImportEmbedsChain(t *testing.T) {
	p := testPool(t)
	snapshotCertKeys(t, p)
	ctx := context.Background()
	mgr := NewCertManager(p, nil)

	// Root CA -> Intermediate CA -> Leaf.
	rootKey := rsaKey(t, 2048)
	rootTpl := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Test Root CA"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(72 * time.Hour),
		KeyUsage: x509.KeyUsageCertSign, IsCA: true, BasicConstraintsValid: true,
	}
	rootDER, _ := x509.CreateCertificate(rand.Reader, rootTpl, rootTpl, rootKey.Public(), rootKey)
	root, _ := x509.ParseCertificate(rootDER)

	interKey := rsaKey(t, 2048)
	interTpl := &x509.Certificate{
		SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "Test Intermediate CA"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(48 * time.Hour),
		KeyUsage: x509.KeyUsageCertSign, IsCA: true, BasicConstraintsValid: true,
	}
	interDER, _ := x509.CreateCertificate(rand.Reader, interTpl, root, interKey.Public(), rootKey)
	inter, _ := x509.ParseCertificate(interDER)

	leafKey := rsaKey(t, 2048)
	leafTpl := &x509.Certificate{
		SerialNumber: big.NewInt(3), Subject: pkix.Name{CommonName: "Chained Leaf Signer"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour),
		KeyUsage:           x509.KeyUsageDigitalSignature | x509.KeyUsageContentCommitment,
		UnknownExtKeyUsage: []asn1.ObjectIdentifier{testDocSigningEKU}, BasicConstraintsValid: true,
	}
	leafDER, _ := x509.CreateCertificate(rand.Reader, leafTpl, inter, leafKey.Public(), interKey)
	leafPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER})
	leafKeyPEM := pem.EncodeToMemory(func() *pem.Block {
		b, _ := x509.MarshalPKCS8PrivateKey(leafKey)
		return &pem.Block{Type: "PRIVATE KEY", Bytes: b}
	}())
	chainPEM := append(
		pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: interDER}),
		pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: rootDER})...,
	)

	ck, err := mgr.Import(ctx, leafPEM, leafKeyPEM, chainPEM)
	if err != nil {
		t.Fatalf("import with chain: %v", err)
	}
	if len(ck.Chain) != 2 {
		t.Fatalf("chain len = %d, want 2 (intermediate + root)", len(ck.Chain))
	}
	if ck.Chain[0].Subject.CommonName != "Test Intermediate CA" {
		t.Fatalf("chain[0] CN = %q", ck.Chain[0].Subject.CommonName)
	}
	if len(ck.ChainPEM) == 0 {
		t.Fatal("ChainPEM empty")
	}
}

// asImportError is a tiny errors.As shim kept local to avoid importing errors
// twice in the file's narrow scope.
func asImportError(err error, target **ImportError) bool {
	for err != nil {
		if ie, ok := err.(*ImportError); ok {
			*target = ie
			return true
		}
		type unwrapper interface{ Unwrap() error }
		u, ok := err.(unwrapper)
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}
