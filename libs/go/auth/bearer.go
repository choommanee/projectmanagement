package auth

import (
	"net/http"
	"strings"
)

// AttachClaims is middleware that softly parses an Authorization: Bearer
// token via verifier and attaches ParsedClaims to context if valid.
//
// Behaviour matrix:
//   - No Authorization / non-Bearer header: pass through unchanged.
//   - Bearer token but verifier == nil: pass through unchanged.
//   - Bearer token that fails verification: pass through unchanged.
//     A downstream RequireAction / RequireActionScoped will return 401
//     "missing claims" if the route requires authn, so callers still get
//     a clear failure mode — but unauthenticated routes (like /healthz)
//     keep working.
//   - Bearer token that verifies: ParsedClaims attached via WithClaims so
//     FromCtx / MustFromCtx find them downstream.
//
// This is the "soft attach" companion to Require: services that already
// gate writes via Cedar (RequireAction) only need claims injected — they
// don't want a blanket 401 on every read.
func AttachClaims(verifier *Verifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if verifier == nil {
				next.ServeHTTP(w, r)
				return
			}
			authz := r.Header.Get("Authorization")
			if !strings.HasPrefix(authz, "Bearer ") {
				next.ServeHTTP(w, r)
				return
			}
			tok := strings.TrimPrefix(authz, "Bearer ")
			c, err := verifier.Verify(tok)
			if err != nil {
				// Bad token: still allow through; RequireAction (if any)
				// will 401 with "missing claims" downstream.
				next.ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r.WithContext(WithClaims(r.Context(), c)))
		})
	}
}
