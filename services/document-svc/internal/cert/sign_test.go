package cert

import (
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

	"github.com/google/uuid"

	"github.com/pmplatform/services/document-svc/internal/domain"
)

func ephemeralSigner(t *testing.T) *Signer {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "PM Platform Document Signing", Organization: []string{"PM Platform"}},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageContentCommitment,
		UnknownExtKeyUsage:    []asn1.ObjectIdentifier{{1, 3, 6, 1, 5, 5, 7, 3, 36}}, // documentSigning
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	crt, _ := x509.ParseCertificate(der)
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	return NewSigner("test-kid", key, crt, pemBytes)
}

func samplePDF(t *testing.T) []byte {
	t.Helper()
	now := time.Now().UTC()
	pdf, err := Generate(Data{
		DocumentTitle: "Trust Layer Test",
		DocumentID:    uuid.NewString(),
		EnvelopeID:    uuid.NewString(),
		ContentHash:   "abc123",
		FinalHash:     "def456",
		CompletedAt:   now,
		Signers: []domain.Signer{{
			ID: uuid.New(), SignerID: uuid.New(), SignerName: "Alice",
			SignerEmail: "a@x.com", Status: domain.SigSigned, SignedAt: &now,
			ChainedHash: "def456",
		}},
	})
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	return pdf
}

func TestSignPDFEmbedsVerifiableSignature(t *testing.T) {
	s := ephemeralSigner(t)
	pdf := samplePDF(t)

	signed, err := s.SignPDF(pdf)
	if err != nil {
		t.Fatalf("SignPDF: %v", err)
	}
	if len(signed) <= len(pdf) {
		t.Fatal("signed PDF should be larger than the input")
	}

	res := VerifyPDF(signed)
	if !res.Signed {
		t.Fatalf("expected embedded signature, got %+v", res)
	}
	if !res.Valid {
		t.Fatalf("expected valid signature, got %+v", res)
	}
	if res.SignerCN != "PM Platform Document Signing" {
		t.Fatalf("unexpected signer CN %q", res.SignerCN)
	}
}

// TestSignPDFRSAWithChainEmbedsChain proves an operator-provided RSA cert with
// an intermediate CA chain signs and verifies, and that the embedded CMS
// carries more than just the leaf (chain path included).
func TestSignPDFRSAWithChainEmbedsChain(t *testing.T) {
	// Root CA.
	rootKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	rootTpl := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "Demo Root CA"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(72 * time.Hour),
		KeyUsage: x509.KeyUsageCertSign, IsCA: true, BasicConstraintsValid: true,
	}
	rootDER, _ := x509.CreateCertificate(rand.Reader, rootTpl, rootTpl, rootKey.Public(), rootKey)
	root, _ := x509.ParseCertificate(rootDER)
	// Intermediate CA.
	interKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	interTpl := &x509.Certificate{
		SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "Demo Intermediate CA"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(48 * time.Hour),
		KeyUsage: x509.KeyUsageCertSign, IsCA: true, BasicConstraintsValid: true,
	}
	interDER, _ := x509.CreateCertificate(rand.Reader, interTpl, root, interKey.Public(), rootKey)
	inter, _ := x509.ParseCertificate(interDER)
	// Leaf signing cert.
	leafKey, _ := rsa.GenerateKey(rand.Reader, 3072)
	leafTpl := &x509.Certificate{
		SerialNumber: big.NewInt(3), Subject: pkix.Name{CommonName: "Acme Document Signer"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour),
		KeyUsage:           x509.KeyUsageDigitalSignature | x509.KeyUsageContentCommitment,
		UnknownExtKeyUsage: []asn1.ObjectIdentifier{{1, 3, 6, 1, 5, 5, 7, 3, 36}}, BasicConstraintsValid: true,
	}
	leafDER, _ := x509.CreateCertificate(rand.Reader, leafTpl, inter, leafKey.Public(), interKey)
	leaf, _ := x509.ParseCertificate(leafDER)
	leafPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER})

	s := NewSignerWithChain("rsa-chain-kid", leafKey, leaf, leafPEM, []*x509.Certificate{inter, root})
	signed, err := s.SignPDF(samplePDF(t))
	if err != nil {
		t.Fatalf("SignPDF: %v", err)
	}
	res := VerifyPDF(signed)
	if !res.Valid {
		t.Fatalf("expected valid signature, got %+v", res)
	}
	if res.SignerCN != "Acme Document Signer" {
		t.Fatalf("signer CN = %q, want operator leaf CN", res.SignerCN)
	}
	if res.CertCount < 2 {
		t.Fatalf("expected embedded chain (cert_count>=2), got %d", res.CertCount)
	}
}

func TestVerifyPDFDetectsTamper(t *testing.T) {
	s := ephemeralSigner(t)
	signed, err := s.SignPDF(samplePDF(t))
	if err != nil {
		t.Fatalf("SignPDF: %v", err)
	}
	// Flip one byte inside the signed byte range (well before the trailing
	// signature dictionary) — verification must fail.
	tampered := append([]byte(nil), signed...)
	tampered[len(tampered)/4] ^= 0xFF
	res := VerifyPDF(tampered)
	if res.Valid {
		t.Fatalf("tampered PDF must not verify: %+v", res)
	}
}

func TestVerifyPDFUnsigned(t *testing.T) {
	res := VerifyPDF(samplePDF(t))
	if res.Signed || res.Valid {
		t.Fatalf("unsigned PDF must report signed=false, got %+v", res)
	}
}

func TestCertificateRendersTSALine(t *testing.T) {
	now := time.Now().UTC()
	rowID := uuid.New()
	pdf, err := Generate(Data{
		DocumentTitle: "TSA Line",
		DocumentID:    uuid.NewString(),
		EnvelopeID:    uuid.NewString(),
		CompletedAt:   now,
		Signers: []domain.Signer{{
			ID: rowID, SignerID: uuid.New(), SignerName: "Alice",
			Status: domain.SigSigned, SignedAt: &now, ChainedHash: "h",
		}},
		TSA: map[uuid.UUID]TSALine{rowID: {GenTime: now, Source: "rfc3161"}},
	})
	if err != nil {
		t.Fatalf("generate with TSA: %v", err)
	}
	if len(pdf) == 0 {
		t.Fatal("empty pdf")
	}
}
