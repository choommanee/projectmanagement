package service

// Trust-layer service logic: RFC 3161 verification reporting, certificate
// PDF TSA lines, and PAdES-style certificate sealing. Kept out of sign.go so
// concurrent workstreams only need minimal hooks there.

import (
	"context"
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/pmplatform/services/document-svc/internal/cert"
	"github.com/pmplatform/services/document-svc/internal/domain"
	"github.com/pmplatform/services/document-svc/internal/keyprov"
	"github.com/pmplatform/services/document-svc/internal/tsa"
)

// WithCertifier attaches the platform X.509 PDF signer; certificates of
// completion generated afterwards carry an embedded digital signature.
func (svc *Service) WithCertifier(c *cert.Signer) *Service {
	svc.certifier.Store(c)
	return svc
}

// Certifier returns the active PAdES PDF signer (nil when unconfigured).
func (svc *Service) Certifier() *cert.Signer { return svc.certifier.Load() }

// WithCertImporter wires the operator-provided-certificate importer that backs
// the POST /v1/admin/sign-cert endpoint.
func (svc *Service) WithCertImporter(im CertImporter) *Service {
	svc.certImporter = im
	return svc
}

// CertInfo is the API-facing metadata for an installed signing certificate.
type CertInfo struct {
	KID                string    `json:"kid"`
	Subject            string    `json:"subject"`
	SubjectCN          string    `json:"subject_cn"`
	Issuer             string    `json:"issuer"`
	IssuerCN           string    `json:"issuer_cn"`
	SerialNumber       string    `json:"serial_number"`
	NotBefore          time.Time `json:"not_before"`
	NotAfter           time.Time `json:"not_after"`
	KeyType            string    `json:"key_type"`
	SelfSigned         bool      `json:"self_signed"`
	ChainLen           int       `json:"chain_len"`
	HasDocumentSigning bool      `json:"has_document_signing_eku"`
	SHA256Fingerprint  string    `json:"sha256_fingerprint"`
}

// ImportSignCert validates and atomically installs an operator-provided X.509
// document-signing certificate, hot-swapping the active PAdES signer. Returns
// the new certificate's metadata. Errors of type *keyprov.ImportError signal
// invalid caller input (HTTP 400).
func (svc *Service) ImportSignCert(ctx context.Context, certPEM, keyPEM, chainPEM []byte) (*CertInfo, error) {
	if svc.certImporter == nil {
		return nil, errors.New("certificate import is not configured")
	}
	ck, err := svc.certImporter.Import(ctx, certPEM, keyPEM, chainPEM)
	if err != nil {
		return nil, err
	}
	svc.certifier.Store(cert.NewSignerWithChain(ck.KID, ck.Key, ck.Cert, ck.CertPEM, ck.Chain))
	info := certInfo(ck)
	return &info, nil
}

// ActiveCertInfo returns metadata for the currently installed signing cert.
func (svc *Service) ActiveCertInfo() (*CertInfo, bool) {
	c := svc.certifier.Load()
	if c == nil {
		return nil, false
	}
	info := certInfoFromSigner(c)
	return &info, true
}

func certInfo(ck *keyprov.CertKey) CertInfo {
	return buildCertInfo(ck.KID, ck.Cert, len(ck.Chain))
}

func certInfoFromSigner(s *cert.Signer) CertInfo {
	return buildCertInfo(s.KID(), s.Cert(), s.ChainLen())
}

// attachTSAVerify enriches chain-verification links with RFC 3161 evidence.
// Links are appended by VerifyChain in signed-signer iteration order, so the
// i-th link corresponds to the i-th signed signer in env.Signers.
func (svc *Service) attachTSAVerify(ctx context.Context, tid uuid.UUID, env *domain.SignEnvelope, res *domain.ChainVerifyResult) {
	records, err := svc.Signatures.TSARecords(ctx, tid, env.ID)
	if err != nil {
		return // links keep TSA=nil — evidence unavailable, not invalid
	}
	li := 0
	for _, s := range env.Signers {
		if s.Status != domain.SigSigned {
			continue
		}
		if li >= len(res.Links) {
			break
		}
		rec := records[s.ID]
		v := tsa.Verify(rec.Token, []byte(s.ChainedHash))
		out := &domain.TSAVerify{
			Present:        v.Present,
			ImprintMatches: v.ImprintMatches,
			Source:         rec.Source,
			Error:          v.Error,
		}
		if v.Present && !v.GenTime.IsZero() {
			gt := v.GenTime
			out.GenTime = &gt
		}
		if out.Source == "" {
			out.Source = "local"
		}
		res.Links[li].TSA = out
		li++
	}
}

// certTSALines builds the per-signer-row TSA detail rendered on the
// Certificate of Completion. Only rows with a real token get a line.
func (svc *Service) certTSALines(ctx context.Context, tid, envID uuid.UUID) map[uuid.UUID]cert.TSALine {
	records, err := svc.Signatures.TSARecords(ctx, tid, envID)
	if err != nil {
		return nil
	}
	out := map[uuid.UUID]cert.TSALine{}
	for rowID, rec := range records {
		if rec.Source == "rfc3161" && rec.Time != nil {
			out[rowID] = cert.TSALine{GenTime: *rec.Time, Source: rec.Source}
		}
	}
	return out
}

// sealCertificate embeds the platform digital signature into a generated
// certificate PDF. Failure degrades to the unsigned PDF (the hash-chain
// content remains intact) rather than blocking certificate availability.
func (svc *Service) sealCertificate(pdf []byte) []byte {
	c := svc.certifier.Load()
	if c == nil {
		return pdf
	}
	signed, err := c.SignPDF(pdf)
	if err != nil {
		// Degrade to the unsigned PDF (hash-chain content stays intact) but
		// surface the failure: a silent degrade means integrity seals could
		// stop applying without anyone noticing.
		log.Warn().Err(err).Msg("certificate PDF sealing failed — returning unsigned certificate; PAdES integrity seal NOT applied")
		return pdf
	}
	return signed
}

// VerifyCertificatePDF verifies the embedded signature of a certificate PDF.
// With body == nil it verifies the stored certificate for the envelope;
// otherwise it verifies caller-supplied bytes (tamper checks).
func (svc *Service) VerifyCertificatePDF(ctx context.Context, tid, envID uuid.UUID, body []byte) (*cert.VerifyResult, error) {
	pdf := body
	if len(pdf) == 0 {
		var err error
		pdf, err = svc.GetCertificate(ctx, tid, envID)
		if err != nil {
			return nil, err
		}
	}
	res := cert.VerifyPDF(pdf)
	return &res, nil
}

// PlatformCertPEM exposes the public X.509 certificate for external
// validators (empty when no certifier is configured).
func (svc *Service) PlatformCertPEM() (kid string, pem []byte) {
	c := svc.certifier.Load()
	if c == nil {
		return "", nil
	}
	return c.KID(), c.CertPEM()
}

// buildCertInfo derives API metadata from a parsed certificate.
func buildCertInfo(kid string, crt *x509.Certificate, chainLen int) CertInfo {
	fp := sha256.Sum256(crt.Raw)
	return CertInfo{
		KID:                kid,
		Subject:            crt.Subject.String(),
		SubjectCN:          crt.Subject.CommonName,
		Issuer:             crt.Issuer.String(),
		IssuerCN:           crt.Issuer.CommonName,
		SerialNumber:       crt.SerialNumber.String(),
		NotBefore:          crt.NotBefore.UTC(),
		NotAfter:           crt.NotAfter.UTC(),
		KeyType:            keyTypeLabel(crt),
		SelfSigned:         crt.Subject.String() == crt.Issuer.String(),
		ChainLen:           chainLen,
		HasDocumentSigning: keyprov.HasDocumentSigningEKU(crt),
		SHA256Fingerprint:  hex.EncodeToString(fp[:]),
	}
}

func keyTypeLabel(crt *x509.Certificate) string {
	switch pub := crt.PublicKey.(type) {
	case *rsa.PublicKey:
		return fmt.Sprintf("RSA-%d", pub.N.BitLen())
	case *ecdsa.PublicKey:
		return "ECDSA-" + pub.Curve.Params().Name
	default:
		return "unknown"
	}
}
