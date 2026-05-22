package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/identity-svc/internal/domain"
	sjwt "github.com/pmplatform/services/identity-svc/internal/jwt"
	"github.com/pmplatform/services/identity-svc/internal/service"
)

// NewRouter wires the identity-svc HTTP surface.
//
// store is used to publish the JWKS, including any rotated-out keys still
// within the grace window. kp is the bootstrap keypair retained for callers
// (tests) that need to verify against a known key.
//
// issuer is the JWT iss claim used to build per-request verifiers for the
// admin endpoint. When issuer is empty or store is nil, the admin endpoint
// is omitted so it can never be reached unauthenticated.
//
// authz is the Cedar-backed authorizer used to gate admin endpoints. When
// nil the admin routes are still mounted (auth required) but the action
// check becomes a no-op — only the test setup does that intentionally.
func NewRouter(auth *service.Auth, kp *sjwt.KeyPair, store *sjwt.Store, issuer string, authz libauth.Authorizer) http.Handler {
	r := chi.NewRouter()
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	r.Get("/.well-known/jwks.json", jwksHandler(kp, store))
	r.Post("/v1/login", login(auth))

	if store != nil && issuer != "" {
		r.Group(func(pr chi.Router) {
			// Verifier is rebuilt per request from the Store's current JWKS
			// so admin tokens signed by the freshly-rotated key still verify
			// without restarting the service.
			pr.Use(requireBearerDynamic(store, issuer))
			// Cedar replaces the previous hardcoded role check.
			pr.Use(libauth.RequireAction(authz, "jwt.rotate", "*"))
			pr.Post("/v1/admin/keys/rotate", rotateKeys(store))
		})
	}
	return r
}

// requireBearerDynamic verifies the Bearer token against a JWKS pulled fresh
// from the Store on every call, then stashes the parsed claims in context
// using the same key libauth.FromCtx reads from.
func requireBearerDynamic(store *sjwt.Store, issuer string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tok := bearerFromRequest(r)
			if tok == "" {
				http.Error(w, "missing token", http.StatusUnauthorized)
				return
			}
			set, err := store.JWKS(r.Context())
			if err != nil {
				http.Error(w, "jwks unavailable", http.StatusServiceUnavailable)
				return
			}
			v := libauth.NewVerifier(set, issuer)
			c, err := v.Verify(tok)
			if err != nil {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}
			// libauth keeps its ctx key private, so re-mount through
			// libauth.Require's WithContext flow: easiest is to set it via
			// the public helper.
			next.ServeHTTP(w, r.WithContext(libauth.WithClaims(r.Context(), c)))
		})
	}
}

func bearerFromRequest(r *http.Request) string {
	h := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(h) < len(prefix) || h[:len(prefix)] != prefix {
		return ""
	}
	return h[len(prefix):]
}

type loginReq struct {
	TenantID string `json:"tenant_id"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

func login(auth *service.Auth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in loginReq
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, 400, err)
			return
		}
		tid, err := uuid.Parse(in.TenantID)
		if err != nil {
			writeErr(w, 400, errors.New("bad tenant_id"))
			return
		}
		tp, err := auth.Login(r.Context(), service.LoginInput{TenantID: tid, Email: in.Email, Password: in.Password})
		if err != nil {
			if errors.Is(err, domain.ErrInvalidCreds) {
				writeErr(w, 401, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, tp)
	}
}

func jwksHandler(kp *sjwt.KeyPair, store *sjwt.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Prefer DB-backed multi-key publication so rotated-out keys remain
		// available within the grace window. Fall back to the in-memory
		// keypair if no store is wired (legacy / test paths).
		if store != nil {
			set, err := store.JWKS(r.Context())
			if err == nil {
				w.Header().Set("Content-Type", "application/json")
				b, _ := json.Marshal(set)
				_, _ = w.Write(b)
				return
			}
			// fall through to in-memory on DB error
		}
		set, err := kp.JWKS()
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		b, _ := json.Marshal(set)
		_, _ = w.Write(b)
	}
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

type rotateReq struct {
	Kid string `json:"kid"`
}

type rotateResp struct {
	Kid        string    `json:"kid"`
	RotatedAt  time.Time `json:"rotated_at"`
	ActiveKids []string  `json:"active_kids"`
}

func rotateKeys(store *sjwt.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in rotateReq
		// Body is optional — empty body / EOF is acceptable.
		_ = json.NewDecoder(r.Body).Decode(&in)

		kid := in.Kid
		if kid == "" {
			kid = fmt.Sprintf("kid-%d", time.Now().UnixNano())
		}

		if _, err := store.Rotate(r.Context(), kid); err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}

		// Collect kids currently published in JWKS so callers can confirm
		// the rotation lifecycle without a second round-trip.
		set, err := store.JWKS(r.Context())
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		kids := make([]string, 0, set.Len())
		for i := 0; i < set.Len(); i++ {
			k, ok := set.Key(i)
			if !ok {
				continue
			}
			kids = append(kids, k.KeyID())
		}

		writeJSON(w, http.StatusOK, rotateResp{
			Kid:        kid,
			RotatedAt:  time.Now().UTC(),
			ActiveKids: kids,
		})
	}
}
