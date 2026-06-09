package main

// Trust-layer boot wiring (kept out of main.go so concurrent workstreams
// only add a single call there):
//
//   - SIGN_KEY_PROVIDER  (db | db-encrypted, default db) — record-signing
//     key custody via internal/keyprov.
//   - SIGN_KEY_MASTER_KEY — base64 32-byte master key (required for
//     db-encrypted; also seals the platform certificate key when set).
//   - TSA_URL — RFC 3161 timestamp authority (default freetsa.org;
//     "off" disables).

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/pmplatform/services/document-svc/internal/cert"
	"github.com/pmplatform/services/document-svc/internal/keyprov"
	"github.com/pmplatform/services/document-svc/internal/service"
	"github.com/pmplatform/services/document-svc/internal/tsa"
)

func wireTrust(ctx context.Context, p *pgxpool.Pool, svc *service.Service) {
	// Key custody provider — a misconfiguration (bad master key, unknown
	// provider) must fail loudly rather than silently sign with the wrong key.
	prov, err := keyprov.FromEnv(p)
	if err != nil {
		log.Fatal().Err(err).Msg("sign-key provider config")
	}
	svc.Signatures.WithKeyProvider(prov)

	// RFC 3161 trusted timestamping — best-effort by design; nil disables.
	if c := tsa.FromEnv(); c != nil {
		svc.Signatures.WithTimestamper(c)
		log.Info().Str("tsa_url", c.URL).Msg("RFC 3161 timestamping enabled")
	}

	// Platform X.509 certificate for PAdES-style certificate-PDF signing.
	// Non-fatal: certificates degrade to unsigned PDFs if bootstrap fails.
	//
	// Precedence:
	//   1. DOC_SIGN_CERT_PEM + DOC_SIGN_KEY_PEM (+ optional DOC_SIGN_CHAIN_PEM)
	//      — operator-provided cert, imported as the active row at boot.
	//   2. existing active document_cert_key row (incl. a prior import or the
	//      runtime POST /v1/admin/sign-cert install).
	//   3. auto-generated self-signed ECDSA P-256 identity (legacy default).
	master, err := keyprov.MasterKeyFromEnv()
	if err != nil {
		log.Fatal().Err(err).Msg("sign-key master key config")
	}
	mgr := keyprov.NewCertManager(p, master)
	// The importer backs POST /v1/admin/sign-cert (runtime atomic swap).
	svc.WithCertImporter(mgr)

	// Env boot-load import (path #1). A configured-but-invalid cert is fatal —
	// silently falling back to the self-signed default would mask a deployment
	// error where the operator believes their CA cert is in use.
	ck, err := mgr.ImportFromEnv(ctx)
	if err != nil {
		log.Fatal().Err(err).Msg("DOC_SIGN_* certificate import failed")
	}
	if ck == nil {
		// Paths #2/#3: load active row or bootstrap the self-signed default.
		ck, err = mgr.LoadOrCreate(ctx)
		if err != nil {
			log.Warn().Err(err).Msg("platform certificate unavailable — certificate PDFs will be unsigned")
			return
		}
	} else {
		log.Info().Str("kid", ck.KID).Str("subject", ck.Cert.Subject.String()).
			Msg("operator-provided document-signing certificate imported from DOC_SIGN_* env")
	}
	svc.WithCertifier(cert.NewSignerWithChain(ck.KID, ck.Key, ck.Cert, ck.CertPEM, ck.Chain))
	log.Info().Str("kid", ck.KID).Int("chain_len", len(ck.Chain)).Msg("certificate-PDF signing enabled")
}
