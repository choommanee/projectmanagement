package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/pmplatform/services/document-svc/internal/domain"
	"github.com/pmplatform/services/document-svc/internal/service"
)

// Public verification (Team F): an external party with a share link — and no
// account — gets an authoritative validity report for a signed document.
//
//   POST   /v1/sign-envelopes/{id}/verify-links            (authed, Cedar document.sign.verify_link.create)
//   GET    /v1/sign-envelopes/{id}/verify-links            (authed read, RLS-scoped)
//   DELETE /v1/sign-envelopes/{id}/verify-links/{linkId}   (authed, same Cedar action — revoke)
//   GET    /public/verify/{token}                          (NO auth)
//   GET    /public/verify/{token}/certificate              (NO auth, application/pdf)
//
// The raw token is returned ONCE by the create call; only its SHA-256 hash is
// stored. Unknown / revoked / expired tokens are an indistinguishable 404.

// publicVerifyBaseURL is where the FE public page lives; used to compose the
// shareable URL returned at link creation.
func publicVerifyBaseURL() string {
	if v := os.Getenv("PUBLIC_VERIFY_BASE_URL"); v != "" {
		return strings.TrimRight(v, "/")
	}
	return "http://localhost:3000"
}

type createVerifyLinkReq struct {
	ExpiresAt *time.Time `json:"expires_at,omitempty"` // nil = no expiry
}

func createVerifyLink(svc *service.Service) http.HandlerFunc {
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
		var req createVerifyLinkReq
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&req) // empty body = defaults
		}
		link, rawToken, err := svc.CreateVerifyLink(r.Context(), service.CreateVerifyLinkInput{
			TenantID:   tid,
			EnvelopeID: envID,
			CreatedBy:  auditMeta(r).ActorID,
			ExpiresAt:  req.ExpiresAt,
		}, auditMeta(r))
		if err != nil {
			writeSignErr(w, err)
			return
		}
		writeJSON(w, 201, map[string]any{
			"link": link,
			// The raw token is shown exactly once — it is never stored and
			// can never be retrieved again.
			"token":      rawToken,
			"public_url": publicVerifyBaseURL() + "/verify/" + rawToken,
		})
	}
}

func listVerifyLinks(svc *service.Service) http.HandlerFunc {
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
		items, err := svc.VerifyLinks.ListForEnvelope(r.Context(), tid, envID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
	}
}

func revokeVerifyLink(svc *service.Service) http.HandlerFunc {
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
		linkID, err := uuid.Parse(chi.URLParam(r, "linkId"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		link, err := svc.RevokeVerifyLink(r.Context(), tid, envID, linkID, auditMeta(r))
		if err != nil {
			writeSignErr(w, err)
			return
		}
		writeJSON(w, 200, link)
	}
}

// publicVerify is mounted OUTSIDE any auth/Cedar middleware: the only
// credential is the 256-bit token in the path. The report is the safe subset
// produced by service.PublicVerify (masked emails, no IPs, no UUIDs).
func publicVerify(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		report, err := svc.PublicVerify(r.Context(), chi.URLParam(r, "token"), auditMeta(r))
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, domain.ErrNotFound)
				return
			}
			writeErr(w, 500, errors.New("verification unavailable"))
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, 200, report)
	}
}

// publicVerifyCertificate serves the same Certificate of Completion PDF as
// the authenticated route, keyed by the public token.
func publicVerifyCertificate(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pdf, err := svc.PublicCertificate(r.Context(), chi.URLParam(r, "token"))
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, domain.ErrNotFound)
				return
			}
			writeErr(w, 500, errors.New("certificate unavailable"))
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `inline; filename="certificate-of-completion.pdf"`)
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(200)
		_, _ = w.Write(pdf)
	}
}
