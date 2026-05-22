package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lestrrat-go/jwx/v2/jwk"

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
	return NewRouterWithRefreshAndReset(auth, refresh, nil, kp, store, issuer, authz, dynAuthz, pool)
}

// NewRouterWithRefreshAndReset is the fullest variant: layers the
// password-reset endpoints on top of the refresh-aware router. A nil
// reset omits the reset endpoints (mirrors the refresh nil-skip).
func NewRouterWithRefreshAndReset(
	auth *service.Auth,
	refresh *service.Refresh,
	reset *service.PasswordReset,
	kp *sjwt.KeyPair,
	store *sjwt.Store,
	issuer string,
	authz libauth.Authorizer,
	dynAuthz *libpolicy.DynamicAdapter,
	pool *pgxpool.Pool,
) http.Handler {
	return NewRouterFull(auth, refresh, reset, nil, kp, store, issuer, authz, dynAuthz, pool)
}

// NewRouterFull layers the MFA endpoints on top of the refresh+reset router.
// A nil mfa omits the MFA endpoints (mirrors the refresh / reset nil-skip).
//
// MFA endpoints split two ways:
//   * /v1/auth/mfa/{enroll,verify,disable} — auth.Require, dynamic JWKS
//   * /v1/auth/mfa/challenge               — anonymous (mfa_token is the credential)
//
// The auth-required endpoints reuse requireBearerDynamic so any rotated
// signing key still verifies without restart, mirroring the admin path.
func NewRouterFull(
	auth *service.Auth,
	refresh *service.Refresh,
	reset *service.PasswordReset,
	mfa *service.MFA,
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
	if reset != nil {
		h.Post("/v1/auth/password/request-reset", requestPasswordReset(reset))
		h.Post("/v1/auth/password/reset", consumePasswordReset(reset))
	}
	if mfa != nil {
		// Challenge is anonymous; the mfa_token is the credential.
		h.Post("/v1/auth/mfa/challenge", mfaChallenge(auth, mfa, store, issuer))

		// Enroll / verify / disable need a real authenticated user.
		// When store + issuer are wired we can build the dynamic-JWKS
		// middleware; otherwise we expose the endpoints with a static
		// verifier built from kp so tests still work without a store.
		if store != nil && issuer != "" {
			h.Group(func(pr chi.Router) {
				pr.Use(requireBearerDynamic(store, issuer))
				pr.Post("/v1/auth/mfa/enroll", mfaEnroll(mfa, auth))
				pr.Post("/v1/auth/mfa/verify", mfaVerify(mfa))
				pr.Post("/v1/auth/mfa/disable", mfaDisable(mfa, auth))
			})
		} else if kp != nil {
			// Test path: seed the global kp registry so mfaChallenge can
			// verify step-up tokens without a Store. Production never
			// hits this branch (store is always non-nil).
			mfaSeedTestKP(kp)
			h.Group(func(pr chi.Router) {
				pr.Use(requireBearerStatic(kp, issuer))
				pr.Post("/v1/auth/mfa/enroll", mfaEnroll(mfa, auth))
				pr.Post("/v1/auth/mfa/verify", mfaVerify(mfa))
				pr.Post("/v1/auth/mfa/disable", mfaDisable(mfa, auth))
			})
		}
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
		resp, err := auth.Login(r.Context(), service.LoginInput{TenantID: tid, Email: in.Email, Password: in.Password})
		if err != nil {
			if errors.Is(err, domain.ErrInvalidCreds) {
				writeErr(w, 401, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, resp)
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

type passwordResetRequestReq struct {
	TenantSlug string `json:"tenant_slug"`
	Email      string `json:"email"`
}

// requestPasswordReset is anonymous and ALWAYS returns 200 with the same
// body regardless of whether (tenant, email) resolved to an account.
// Anti-enumeration: attackers can't probe for valid emails.
func requestPasswordReset(svc *service.PasswordReset) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in passwordResetRequestReq
		// Even a malformed body returns 200 with the canonical message so
		// scanners can't differentiate "bad request" from "unknown user".
		_ = json.NewDecoder(r.Body).Decode(&in)
		if in.TenantSlug != "" && in.Email != "" {
			// Best-effort dispatch; service swallows errors internally.
			_ = svc.RequestReset(r.Context(), in.TenantSlug, in.Email)
		}
		writeJSON(w, http.StatusOK, map[string]string{
			"message": "if the account exists, an email has been sent",
		})
	}
}

type passwordResetConsumeReq struct {
	Token       string `json:"token"`
	NewPassword string `json:"new_password"`
}

// consumePasswordReset is anonymous (the token IS the credential). All
// validation failures collapse to 400 with a generic message — same
// anti-enumeration logic as request-reset.
func consumePasswordReset(svc *service.PasswordReset) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in passwordResetConsumeReq
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, errors.New("bad request"))
			return
		}
		if in.Token == "" || in.NewPassword == "" {
			writeErr(w, http.StatusBadRequest, errors.New("token and new_password required"))
			return
		}
		if err := svc.ConsumeReset(r.Context(), in.Token, in.NewPassword); err != nil {
			if errors.Is(err, domain.ErrPasswordResetInvalid) ||
				errors.Is(err, domain.ErrPasswordResetExpired) ||
				errors.Is(err, domain.ErrPasswordResetConsumed) ||
				errors.Is(err, domain.ErrPasswordResetMalformed) {
				writeErr(w, http.StatusBadRequest, errors.New("invalid or expired token"))
				return
			}
			if errors.Is(err, domain.ErrPasswordWeak) {
				writeErr(w, http.StatusBadRequest, err)
				return
			}
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"message": "password updated"})
	}
}

type policyReloadResp struct {
	ReloadedAt time.Time `json:"reloaded_at"`
	Version    int       `json:"version"`
}

// requireBearerStatic is the test-friendly sibling of requireBearerDynamic:
// it verifies the bearer token against a single in-memory keypair (kp) so
// tests can mount the auth-required MFA endpoints without standing up a
// DB-backed Store. When issuer is empty, the issuer check is skipped — this
// matches the test setup which signs with the same empty/"test" issuer it
// passes to the router.
func requireBearerStatic(kp *sjwt.KeyPair, issuer string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tok := bearerFromRequest(r)
			if tok == "" {
				http.Error(w, "missing token", http.StatusUnauthorized)
				return
			}
			set, err := kp.JWKS()
			if err != nil {
				http.Error(w, "jwks unavailable", http.StatusServiceUnavailable)
				return
			}
			iss := issuer
			if iss == "" {
				iss = "test"
			}
			v := libauth.NewVerifier(set, iss)
			c, err := v.Verify(tok)
			if err != nil {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r.WithContext(libauth.WithClaims(r.Context(), c)))
		})
	}
}

// mfaEnrollReq is empty by design — the user/tenant are taken from the
// authenticated claims. We accept a body for forward-compat (e.g. a future
// `display_name` for the otpauth label) without requiring one today.
type mfaEnrollReq struct{}

// mfaEnroll handler. Authenticated. Returns the otpauth URL + plaintext
// backup codes ONCE; subsequent calls (when confirmed) return 409.
func mfaEnroll(mfa *service.MFA, auth *service.Auth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, ok := libauth.FromCtx(r.Context())
		if !ok {
			writeErr(w, http.StatusUnauthorized, errors.New("no claims"))
			return
		}
		tid, err := uuid.Parse(c.TenantID)
		if err != nil {
			writeErr(w, http.StatusBadRequest, errors.New("bad tenant in claims"))
			return
		}
		uid, err := uuid.Parse(c.Subject)
		if err != nil {
			writeErr(w, http.StatusBadRequest, errors.New("bad subject in claims"))
			return
		}
		// Resolve the email so the otpauth label is human-readable.
		email, err := auth.LookupEmail(r.Context(), tid, uid)
		if err != nil {
			email = c.Subject
		}
		resp, err := mfa.Enroll(r.Context(), tid, uid, email)
		if err != nil {
			if errors.Is(err, domain.ErrMFAAlreadyEnrolled) {
				writeErr(w, http.StatusConflict, err)
				return
			}
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

type mfaVerifyReq struct {
	Code string `json:"code"`
}

func mfaVerify(mfa *service.MFA) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in mfaVerifyReq
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		c, ok := libauth.FromCtx(r.Context())
		if !ok {
			writeErr(w, http.StatusUnauthorized, errors.New("no claims"))
			return
		}
		tid, _ := uuid.Parse(c.TenantID)
		uid, _ := uuid.Parse(c.Subject)
		if err := mfa.Verify(r.Context(), tid, uid, in.Code); err != nil {
			switch {
			case errors.Is(err, domain.ErrMFAInvalidCode):
				writeErr(w, http.StatusUnauthorized, err)
			case errors.Is(err, domain.ErrMFARateLimited):
				writeErr(w, http.StatusTooManyRequests, err)
			case errors.Is(err, domain.ErrMFANotEnrolled):
				writeErr(w, http.StatusNotFound, err)
			case errors.Is(err, domain.ErrMFAAlreadyEnrolled):
				writeErr(w, http.StatusConflict, err)
			default:
				writeErr(w, http.StatusInternalServerError, err)
			}
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "confirmed"})
	}
}

type mfaDisableReq struct {
	CurrentPassword string `json:"current_password"`
}

func mfaDisable(mfa *service.MFA, auth *service.Auth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in mfaDisableReq
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		if in.CurrentPassword == "" {
			writeErr(w, http.StatusBadRequest, errors.New("current_password required"))
			return
		}
		c, ok := libauth.FromCtx(r.Context())
		if !ok {
			writeErr(w, http.StatusUnauthorized, errors.New("no claims"))
			return
		}
		tid, _ := uuid.Parse(c.TenantID)
		uid, _ := uuid.Parse(c.Subject)
		hash, err := auth.LookupPasswordHash(r.Context(), tid, uid)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, err)
			return
		}
		if err := mfa.Disable(r.Context(), tid, uid, hash, in.CurrentPassword); err != nil {
			if errors.Is(err, domain.ErrInvalidCreds) {
				writeErr(w, http.StatusUnauthorized, err)
				return
			}
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "disabled"})
	}
}

type mfaChallengeReq struct {
	MFAToken string `json:"mfa_token"`
	Code     string `json:"code"`
}

// mfaChallenge is anonymous: the mfa_token is the only credential. We
// verify it against the current JWKS, confirm it carries the MFA pending
// sentinel role, run the challenge, and on success mint the real
// access/refresh pair via Auth.IssueSession.
func mfaChallenge(auth *service.Auth, mfa *service.MFA, store *sjwt.Store, issuer string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in mfaChallengeReq
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.MFAToken == "" || in.Code == "" {
			writeErr(w, http.StatusBadRequest, errors.New("mfa_token and code required"))
			return
		}
		c, err := verifyMFAToken(r.Context(), in.MFAToken, store, issuer)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, domain.ErrMFATokenInvalid)
			return
		}
		tid, _ := uuid.Parse(c.TenantID)
		uid, _ := uuid.Parse(c.Subject)
		if err := mfa.Challenge(r.Context(), tid, uid, in.Code); err != nil {
			switch {
			case errors.Is(err, domain.ErrMFAInvalidCode):
				writeErr(w, http.StatusUnauthorized, err)
			case errors.Is(err, domain.ErrMFARateLimited):
				writeErr(w, http.StatusTooManyRequests, err)
			case errors.Is(err, domain.ErrMFANotEnrolled):
				writeErr(w, http.StatusUnauthorized, err)
			default:
				writeErr(w, http.StatusInternalServerError, err)
			}
			return
		}
		tp, err := auth.IssueSession(r.Context(), tid, uid)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, tp)
	}
}

// verifyMFAToken parses the short-lived step-up JWT. Source-of-truth for
// the verifier:
//   * Production / live: store.JWKS (rotated-aware).
//   * Tests with a nil store: build a JWKS from the bootstrap keypair held
//     by the static-verifier middleware. The challenge handler doesn't have
//     direct access to kp, so we accept it as a fallback path through
//     store == nil + a process-global registry seeded by NewRouterFull.
//
// We also require the Roles claim to contain MFAStepUpRoleSentinel — that's
// what distinguishes a step-up token from a full access token. Without this
// check, any valid access token could be used as a step-up credential.
func verifyMFAToken(ctx context.Context, tok string, store *sjwt.Store, issuer string) (*libauth.ParsedClaims, error) {
	var v *libauth.Verifier
	if store != nil {
		set, err := store.JWKS(ctx)
		if err != nil {
			return nil, err
		}
		iss := issuer
		if iss == "" {
			iss = "test"
		}
		v = libauth.NewVerifier(set, iss)
	} else {
		set := mfaTestJWKS()
		if set == nil {
			return nil, errors.New("no jwks available")
		}
		iss := issuer
		if iss == "" {
			iss = "test"
		}
		v = libauth.NewVerifier(set, iss)
	}
	c, err := v.Verify(tok)
	if err != nil {
		return nil, err
	}
	hasSentinel := false
	for _, r := range c.Roles {
		if r == service.MFAStepUpRoleSentinel {
			hasSentinel = true
			break
		}
	}
	if !hasSentinel {
		return nil, errors.New("not an mfa step-up token")
	}
	return c, nil
}

// mfaTestKP is the bootstrap keypair NewRouterFull seeds when no Store is
// wired (test path). It's process-global because the challenge handler
// needs to verify a token without a closure over the kp. Production never
// hits this path because store is always non-nil.
var (
	mfaTestKPMu sync.Mutex
	mfaTestKP   *sjwt.KeyPair
)

func mfaSeedTestKP(kp *sjwt.KeyPair) {
	mfaTestKPMu.Lock()
	defer mfaTestKPMu.Unlock()
	mfaTestKP = kp
}

func mfaTestJWKS() jwk.Set {
	mfaTestKPMu.Lock()
	defer mfaTestKPMu.Unlock()
	if mfaTestKP == nil {
		return nil
	}
	set, err := mfaTestKP.JWKS()
	if err != nil {
		return nil
	}
	return set
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
