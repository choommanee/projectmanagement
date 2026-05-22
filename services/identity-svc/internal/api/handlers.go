package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	libauth "github.com/pmplatform/libs/go/auth"
	libpolicy "github.com/pmplatform/libs/policy"

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
	return NewRouterWithPolicy(auth, kp, store, issuer, authz, nil, nil)
}

// NewRouterWithRefresh is the variant the live server uses when a Refresh
// service is wired. When refresh is nil the /v1/auth/refresh endpoint is
// omitted so tests / minimal deployments don't accidentally expose it.
func NewRouterWithRefresh(
	auth *service.Auth,
	refresh *service.Refresh,
	kp *sjwt.KeyPair,
	store *sjwt.Store,
	issuer string,
	authz libauth.Authorizer,
	dynAuthz *libpolicy.DynamicAdapter,
	pool *pgxpool.Pool,
) http.Handler {
	h := NewRouterWithPolicy(auth, kp, store, issuer, authz, dynAuthz, pool).(*chi.Mux)
	if refresh != nil {
		h.Post("/v1/auth/refresh", refreshHandler(refresh))
	}
	return h
}

// NewRouterWithPolicy is the variant used by the live server: it threads the
// DynamicAdapter holder and Postgres pool needed for /v1/admin/policy/reload.
// When either is nil the reload endpoint is omitted (so tests that don't
// exercise reload can keep using NewRouter).
//
// authz should typically BE the dynAuthz holder so the same instance gates
// every admin route AND is the swap target for reload.
func NewRouterWithPolicy(
	auth *service.Auth,
	kp *sjwt.KeyPair,
	store *sjwt.Store,
	issuer string,
	authz libauth.Authorizer,
	dynAuthz *libpolicy.DynamicAdapter,
	pool *pgxpool.Pool,
) http.Handler {
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
		if dynAuthz != nil && pool != nil {
			r.Group(func(pr chi.Router) {
				pr.Use(requireBearerDynamic(store, issuer))
				pr.Use(libauth.RequireAction(authz, "policy.reload", "*"))
				pr.Post("/v1/admin/policy/reload", reloadPolicy(pool, dynAuthz))
			})
		}
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

type refreshReq struct {
	RefreshToken string `json:"refresh_token"`
}

// refreshHandler is anonymous — the refresh token itself is the credential.
// Failure modes are deliberately collapsed to a single 401 to avoid leaking
// rotation state to an attacker.
func refreshHandler(r *service.Refresh) http.HandlerFunc {
	return func(w http.ResponseWriter, req *http.Request) {
		var in refreshReq
		if err := json.NewDecoder(req.Body).Decode(&in); err != nil || in.RefreshToken == "" {
			writeErr(w, 400, errors.New("bad refresh_token"))
			return
		}
		tp, err := r.Rotate(req.Context(), in.RefreshToken)
		if err != nil {
			if errors.Is(err, domain.ErrRefreshTokenInvalid) {
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

type policyReloadResp struct {
	ReloadedAt time.Time `json:"reloaded_at"`
	Version    int       `json:"version"`
}

// reloadPolicy re-reads the active policy_bundle row, parses it, and atomically
// swaps the live DynamicAdapter to point at the new PolicySet. The swap is a
// single atomic.Pointer write so in-flight requests either see the old or new
// adapter, never a torn intermediate.
func reloadPolicy(pool *pgxpool.Pool, dynAuthz *libpolicy.DynamicAdapter) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ps, version, err := libpolicy.LoadFromDB(r.Context(), pool)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		dynAuthz.Swap(&libpolicy.Adapter{Policies: ps})
		writeJSON(w, http.StatusOK, policyReloadResp{
			ReloadedAt: time.Now().UTC(),
			Version:    version,
		})
	}
}
