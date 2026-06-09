package api

import (
	"errors"
	"net/http"

	"github.com/pmplatform/services/document-svc/internal/domain"
	"github.com/pmplatform/services/document-svc/internal/service"
)

// requestSignOTP handles POST /v1/sign-envelopes/{id}/signers/{signerId}/otp/request.
//
// Cedar posture mirrors document.sign.sign: any authenticated tenant user
// passes the gate; the service layer enforces that the JWT actor IS the
// routed signer (403 otherwise). Issues a 6-digit email OTP challenge
// (10 min TTL, 5 attempts, 3 requests / 5 min rate limit).
func requestSignOTP(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		envID, signerID, ok := envSignerIDs(w, r)
		if !ok {
			return
		}
		res, err := svc.RequestSignOTP(r.Context(), tid, envID, signerID, auditMeta(r))
		if err != nil {
			writeOTPErr(w, err)
			return
		}
		writeJSON(w, 200, res)
	}
}

// writeOTPErr maps OTP step-up errors to HTTP, falling back to the standard
// sign-error mapping. Also used by the sign handler path via writeSignErr.
func writeOTPErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrOTPRequired):
		// 428 Precondition Required: signer must complete the OTP step-up.
		writeErr(w, http.StatusPreconditionRequired, err)
	case errors.Is(err, domain.ErrOTPInvalid), errors.Is(err, domain.ErrOTPExpired):
		writeErr(w, http.StatusForbidden, err)
	case errors.Is(err, domain.ErrOTPRateLimited):
		writeErr(w, http.StatusTooManyRequests, err)
	default:
		writeSignErr(w, err)
	}
}

// isOTPErr reports whether err belongs to the OTP step-up taxonomy.
func isOTPErr(err error) bool {
	return errors.Is(err, domain.ErrOTPRequired) ||
		errors.Is(err, domain.ErrOTPInvalid) ||
		errors.Is(err, domain.ErrOTPExpired) ||
		errors.Is(err, domain.ErrOTPRateLimited)
}
