package cert

import (
	"bytes"
	"crypto"
	"crypto/x509"
	"fmt"
	"time"

	"github.com/digitorus/pdf"
	"github.com/digitorus/pdfsign/sign"
	"github.com/digitorus/pdfsign/verify"
)

// Signer embeds a PAdES-style digital signature into generated certificate
// PDFs using the platform X.509 document-signing identity (see
// keyprov.CertKey). The signature covers the full byte range of the PDF, so
// any post-generation tampering invalidates it.
type Signer struct {
	kid     string
	key     crypto.Signer
	cert    *x509.Certificate
	certPEM []byte
	// chain holds the intermediate CA certificates (leaf->root, intermediates
	// only) embedded into the PAdES signature so a validator can build the path
	// to the operator's CA. Empty for the self-signed default identity.
	chain []*x509.Certificate
}

// NewSigner builds a PDF signer from the platform certificate key.
func NewSigner(kid string, key crypto.Signer, certificate *x509.Certificate, certPEM []byte) *Signer {
	return &Signer{kid: kid, key: key, cert: certificate, certPEM: certPEM}
}

// NewSignerWithChain builds a PDF signer that embeds the supplied intermediate
// CA chain alongside the leaf certificate.
func NewSignerWithChain(kid string, key crypto.Signer, certificate *x509.Certificate, certPEM []byte, chain []*x509.Certificate) *Signer {
	return &Signer{kid: kid, key: key, cert: certificate, certPEM: certPEM, chain: chain}
}

// KID returns the platform certificate key id.
func (s *Signer) KID() string { return s.kid }

// CertPEM returns the public X.509 certificate (PEM) for external validation.
func (s *Signer) CertPEM() []byte { return s.certPEM }

// Cert returns the parsed leaf certificate.
func (s *Signer) Cert() *x509.Certificate { return s.cert }

// ChainLen returns the number of embedded intermediate CA certificates.
func (s *Signer) ChainLen() int { return len(s.chain) }

// SignPDF returns pdfBytes with an embedded certification signature.
func (s *Signer) SignPDF(pdfBytes []byte) ([]byte, error) {
	if s == nil {
		return pdfBytes, nil
	}
	rdr, err := pdf.NewReader(bytes.NewReader(pdfBytes), int64(len(pdfBytes)))
	if err != nil {
		return nil, fmt.Errorf("cert: parse pdf for signing: %w", err)
	}
	// Embed the leaf followed by any intermediate CA certs so a validator can
	// build the trust path to the operator's CA. pdfsign reads chain[0][1:] as
	// the certificates added after the leaf.
	var chains [][]*x509.Certificate
	if len(s.chain) > 0 {
		full := append([]*x509.Certificate{s.cert}, s.chain...)
		chains = [][]*x509.Certificate{full}
	}
	var out bytes.Buffer
	err = sign.Sign(bytes.NewReader(pdfBytes), &out, rdr, int64(len(pdfBytes)), sign.SignData{
		Signature: sign.SignDataSignature{
			CertType:   sign.CertificationSignature,
			DocMDPPerm: sign.DoNotAllowAnyChangesPerms,
			Info: sign.SignDataSignatureInfo{
				Name:        signerName(s.cert),
				Location:    "PM Platform e-signature service",
				Reason:      "Certificate of Completion integrity seal",
				ContactInfo: "kid=" + s.kid,
				Date:        time.Now().UTC(),
			},
		},
		Signer:            s.key,
		DigestAlgorithm:   crypto.SHA256,
		Certificate:       s.cert,
		CertificateChains: chains,
	})
	if err != nil {
		return nil, fmt.Errorf("cert: embed pdf signature: %w", err)
	}
	return out.Bytes(), nil
}

// VerifyResult is the API-facing summary of embedded-signature verification.
type VerifyResult struct {
	Signed        bool       `json:"signed"`
	Valid         bool       `json:"valid"`
	SignerCN      string     `json:"signer_cn,omitempty"`
	IssuerCN      string     `json:"issuer_cn,omitempty"`
	CertCount     int        `json:"cert_count,omitempty"`
	Reason        string     `json:"reason,omitempty"`
	TrustedIssuer bool       `json:"trusted_issuer"`
	SignedAt      *time.Time `json:"signed_at,omitempty"`
	Error         string     `json:"error,omitempty"`
}

// VerifyPDF checks the embedded signature of a certificate PDF. The platform
// certificate is self-signed, so verification allows untrusted roots — the
// guarantee asserted here is byte-level integrity + key possession, not CA
// pedigree (trusted_issuer reports the CA view separately).
func VerifyPDF(pdfBytes []byte) VerifyResult {
	opts := verify.DefaultVerifyOptions()
	opts.AllowUntrustedRoots = true
	opts.TrustSignatureTime = true
	// BYO-cert support: accept the RFC 9336 documentSigning EKU (preferred) OR
	// the common emailProtection / clientAuth alternatives without flagging the
	// latter as "not preferred". Operator-provided CA certs frequently carry
	// emailProtection rather than documentSigning. The cert must still assert a
	// digitalSignature key usage (the default RequireDigitalSignatureKU stays).
	opts.RequiredEKUs = nil
	opts.AllowedEKUs = []x509.ExtKeyUsage{
		x509.ExtKeyUsage(36), // 1.3.6.1.5.5.7.3.36 id-kp-documentSigning
		x509.ExtKeyUsageEmailProtection,
		x509.ExtKeyUsageClientAuth,
	}
	resp, err := verify.VerifyWithOptions(bytes.NewReader(pdfBytes), int64(len(pdfBytes)), opts)
	if err != nil {
		return VerifyResult{Signed: false, Valid: false, Error: err.Error()}
	}
	res := VerifyResult{Signed: len(resp.Signers) > 0, Error: resp.Error}
	if len(resp.Signers) == 0 {
		res.Error = nonEmpty(res.Error, "no embedded signature found")
		return res
	}
	sg := resp.Signers[0]
	res.Valid = sg.ValidSignature
	res.TrustedIssuer = sg.TrustedIssuer
	res.Reason = sg.Reason
	res.SignedAt = sg.SignatureTime
	res.CertCount = len(sg.Certificates)
	if len(sg.Certificates) > 0 && sg.Certificates[0].Certificate != nil {
		res.SignerCN = sg.Certificates[0].Certificate.Subject.CommonName
		res.IssuerCN = sg.Certificates[0].Certificate.Issuer.CommonName
	}
	return res
}

// signerName renders the display name for the signature dictionary from the
// certificate subject (CN preferred, else the full DN string).
func signerName(crt *x509.Certificate) string {
	if crt == nil {
		return "PM Platform Document Signing"
	}
	if crt.Subject.CommonName != "" {
		return crt.Subject.CommonName
	}
	return crt.Subject.String()
}

func nonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
