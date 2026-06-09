package api

// Trust-layer HTTP surface: platform certificate download + certificate-PDF
// signature verification. Both are reads (no state change) and follow the
// same open-within-tenant posture as GET /v1/sign-envelopes/{id}/verify, so
// no new Cedar actions are required.

import (
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/pmplatform/services/document-svc/internal/service"
)

// registerTrustRoutes mounts the trust-layer routes under /v1.
func registerTrustRoutes(r chi.Router, svc *service.Service) {
	// Public X.509 platform document-signing certificate (PEM) — lets an
	// external validator (Adobe Reader trust store, openssl) verify the
	// embedded certificate-PDF signature.
	r.Get("/sign-keys/certificate.pem", platformCertPEM(svc))
	// Verify the embedded PAdES-style signature of a certificate PDF.
	// GET verifies the stored certificate; POST verifies caller-supplied
	// PDF bytes (read-only check — used for tamper demonstrations).
	r.Get("/sign-envelopes/{id}/certificate/verify", verifyCertificate(svc))
	r.Post("/sign-envelopes/{id}/certificate/verify", verifyCertificate(svc))
}

func platformCertPEM(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kid, pem := svc.PlatformCertPEM()
		if len(pem) == 0 {
			writeErr(w, 404, errors.New("platform certificate not configured"))
			return
		}
		w.Header().Set("Content-Type", "application/x-pem-file")
		w.Header().Set("X-Certificate-Kid", kid)
		w.Header().Set("Content-Disposition", `attachment; filename="pm-platform-document-signing.pem"`)
		w.WriteHeader(200)
		_, _ = w.Write(pem)
	}
}

func verifyCertificate(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		envID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var body []byte
		if r.Method == http.MethodPost {
			body, err = io.ReadAll(io.LimitReader(r.Body, 16<<20))
			if err != nil {
				writeErr(w, 400, err)
				return
			}
		}
		res, err := svc.VerifyCertificatePDF(r.Context(), tid, envID, body)
		if err != nil {
			writeSignErr(w, err)
			return
		}
		writeJSON(w, 200, res)
	}
}
