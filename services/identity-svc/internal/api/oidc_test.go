package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lestrrat-go/jwx/v2/jwa"
	"github.com/lestrrat-go/jwx/v2/jwk"
	"github.com/lestrrat-go/jwx/v2/jws"
	"github.com/lestrrat-go/jwx/v2/jwt"

	libauth "github.com/pmplatform/libs/go/auth"
	"github.com/pmplatform/libs/go/audit"

	"github.com/pmplatform/services/identity-svc/internal/domain"
	sjwt "github.com/pmplatform/services/identity-svc/internal/jwt"
	"github.com/pmplatform/services/identity-svc/internal/service"
	"github.com/pmplatform/services/identity-svc/internal/store"
)

// ssoTestMasterKey is a constant 32-byte hex key for tests. Per-tenant key
// derivation isolates each test case even when this value is reused.
const ssoTestMasterKey = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"

// mockIdP is a tiny OIDC issuer used in tests. It serves:
//   * /.well-known/openid-configuration
//   * /jwks  (public RSA key)
//   * /token (returns a static id_token signed with the matching RSA priv key)
//   * /authorize (no-op; returns 200 so we can hit it directly from tests)
//
// The flow under test is: identity-svc /start → (no IdP roundtrip, we just
// exchange code via the token endpoint) → /callback. The test forges a
// signed-state JWT, calls /callback with `state=<that>&code=ANY`, and the
// server hits the mock's /token to get an id_token whose claims drive
// user-resolution.
type mockIdP struct {
	priv    *rsa.PrivateKey
	keyID   string
	srv     *httptest.Server
	subject string
	email   string
	name    string
	// nextIDToken lets a test override the id_token returned by /token (e.g.
	// for expired-token cases). Default: signed from claims above.
	nextIDToken string
}

func newMockIdP(t *testing.T) *mockIdP {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	mp := &mockIdP{
		priv:    priv,
		keyID:   "mock-1",
		subject: "external-" + uuid.NewString()[:8],
		email:   "sso-" + uuid.NewString()[:6] + "@example.com",
		name:    "SSO User",
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		base := "http://" + r.Host
		cfg := map[string]any{
			"issuer":                                base,
			"authorization_endpoint":                base + "/authorize",
			"token_endpoint":                        base + "/token",
			"jwks_uri":                              base + "/jwks",
			"response_types_supported":              []string{"code"},
			"subject_types_supported":               []string{"public"},
			"id_token_signing_alg_values_supported": []string{"RS256"},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(cfg)
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, r *http.Request) {
		// Hand-rolled JWKS payload so we don't depend on jwx's marshaller.
		n := base64.RawURLEncoding.EncodeToString(priv.PublicKey.N.Bytes())
		eBytes := big.NewInt(int64(priv.PublicKey.E)).Bytes()
		e := base64.RawURLEncoding.EncodeToString(eBytes)
		set := map[string]any{
			"keys": []map[string]string{{
				"kty": "RSA",
				"use": "sig",
				"alg": "RS256",
				"kid": mp.keyID,
				"n":   n,
				"e":   e,
			}},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(set)
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		// We ignore the form body; the test owns the code value and we
		// always return the configured id_token.
		idTok := mp.nextIDToken
		if idTok == "" {
			tok, err := mp.makeIDToken(r.Host, mp.subject, mp.email, mp.name, time.Hour)
			if err != nil {
				http.Error(w, err.Error(), 500)
				return
			}
			idTok = tok
		}
		resp := map[string]any{
			"access_token": "mock-access",
			"token_type":   "Bearer",
			"id_token":     idTok,
			"expires_in":   3600,
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	})
	mux.HandleFunc("/authorize", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
	})
	mp.srv = httptest.NewServer(mux)
	return mp
}

// makeIDToken signs an RS256 id_token with the mock's private key. Audience
// is the client_id under test; the caller passes the issuer (which must
// match the mock's external URL).
func (mp *mockIdP) makeIDToken(host, sub, email, name string, ttl time.Duration) (string, error) {
	iss := "http://" + host
	return mp.signClaimsFor(iss, sub, email, name, ttl)
}

func (mp *mockIdP) signClaimsFor(iss, sub, email, name string, ttl time.Duration) (string, error) {
	tok, err := jwt.NewBuilder().
		Issuer(iss).
		Subject(sub).
		Audience([]string{mockClientID}).
		Expiration(time.Now().Add(ttl)).
		IssuedAt(time.Now()).
		Claim("email", email).
		Claim("name", name).
		Build()
	if err != nil {
		return "", err
	}
	key, err := jwk.FromRaw(mp.priv)
	if err != nil {
		return "", err
	}
	_ = key.Set(jwk.KeyIDKey, mp.keyID)
	_ = key.Set(jwk.AlgorithmKey, jwa.RS256)
	signed, err := jwt.Sign(tok, jwt.WithKey(jwa.RS256, key, jws.WithProtectedHeaders(jws.NewHeaders())))
	if err != nil {
		return "", err
	}
	return string(signed), nil
}

func (mp *mockIdP) issuer() string { return mp.srv.URL }
func (mp *mockIdP) close()         { mp.srv.Close() }

// mockClientID is the OAuth2 client_id wired into the sso_config row. The
// mock IdP rubber-stamps it via the aud claim.
const mockClientID = "test-client"

type oidcSetup struct {
	h        http.Handler
	p        *pgxpool.Pool
	tid      uuid.UUID
	slug     string
	signer   *libauth.Signer
	kp       *sjwt.KeyPair
	oidcSvc  *service.OIDC
	configID uuid.UUID
	idp      *mockIdP
}

func oidcTestSetup(t *testing.T, allowJIT bool) (*oidcSetup, func()) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skip(err)
	}

	ctx := context.Background()
	tid := uuid.New()
	slug := "sso-" + uuid.NewString()[:6]
	if _, err := p.Exec(ctx,
		`INSERT INTO tenant(id, slug, name) VALUES ($1,$2,'S')`, tid, slug); err != nil {
		p.Close()
		t.Fatal(err)
	}

	idp := newMockIdP(t)

	kp, _ := sjwt.GenerateKeyPair("kid-test")
	signer := libauth.NewSigner(kp.Priv, "test")
	pub := audit.NewPgPublisher(p, "test")

	users := store.NewUsers(p)
	tokens := store.NewRefreshTokens(p)
	mfaEnrollments := store.NewMFAEnrollments(p)
	ssoConfigs := store.NewSSOConfigs(p)

	auth := service.NewAuth(users, store.NewSessions(p), signer, pub).
		WithRefreshTokens(tokens, 30*24*time.Hour).
		WithMFA(mfaEnrollments)
	refresh := service.NewRefresh(users, tokens, signer, pub)

	oidcSvc, err := service.NewOIDC(ssoConfigs, users, auth, p, ssoTestMasterKey, "http://web.test", pub)
	if err != nil {
		p.Close()
		idp.close()
		t.Fatal(err)
	}

	// Insert a sso_config row directly. The admin endpoint test path uses
	// service.CreateConfig; the start/callback flow is what we're testing
	// here, and seeding the row directly keeps each test focused.
	cfg, err := oidcSvc.CreateConfig(ctx, tid, service.OIDCConfigInput{
		IssuerURL:            idp.issuer(),
		ClientID:             mockClientID,
		ClientSecret:         "test-secret",
		RedirectURI:          "http://identity.test/v1/auth/oidc/" + slug + "/callback",
		Scopes:               []string{"openid", "email", "profile"},
		AllowJITProvisioning: allowJIT,
	})
	if err != nil {
		p.Close()
		idp.close()
		t.Fatal(err)
	}

	h := NewRouterFullWithOIDC(auth, refresh, nil, nil, oidcSvc, kp, nil, "", nil, nil, nil)

	cleanup := func() {
		// CASCADE delete: tenant → app_user → sso_config → role_assignment.
		_, _ = p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tid)
		p.Close()
		idp.close()
	}
	return &oidcSetup{
		h:        h,
		p:        p,
		tid:      tid,
		slug:     slug,
		signer:   signer,
		kp:       kp,
		oidcSvc:  oidcSvc,
		configID: cfg.ID,
		idp:      idp,
	}, cleanup
}

// callbackJSON drives a GET /v1/auth/oidc/{slug}/callback with Accept JSON
// so the handler returns a TokenPair body instead of a 302.
func callbackJSON(h http.Handler, slug, state, code string) *httptest.ResponseRecorder {
	q := url.Values{}
	q.Set("state", state)
	q.Set("code", code)
	req := httptest.NewRequest("GET",
		"/v1/auth/oidc/"+slug+"/callback?"+q.Encode(), nil)
	req.Header.Set("Accept", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// startGET hits /start and returns the recorded response so callers can
// inspect the Location header (302 redirect to the IdP).
func startGET(h http.Handler, slug, providerID string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("GET",
		"/v1/auth/oidc/"+slug+"/start?provider="+providerID, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// freshState mints a valid state token via the OIDC service so each test
// can exercise /callback without bouncing through /start. The state encodes
// the same tenant + config the seeded row uses.
func (s *oidcSetup) freshState(t *testing.T, redirectAfter string) string {
	t.Helper()
	res, err := s.oidcSvc.Start(context.Background(), s.slug, s.configID.String(), redirectAfter)
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(res.RedirectURL)
	if err != nil {
		t.Fatal(err)
	}
	return u.Query().Get("state")
}

func TestOIDCStartRedirectsToIdP(t *testing.T) {
	s, cleanup := oidcTestSetup(t, false)
	defer cleanup()

	rec := startGET(s.h, s.slug, s.configID.String())
	if rec.Code != http.StatusFound {
		t.Fatalf("start: got %d want 302: %s", rec.Code, rec.Body.String())
	}
	loc := rec.Header().Get("Location")
	if loc == "" {
		t.Fatal("start: no Location header")
	}
	if !strings.HasPrefix(loc, s.idp.issuer()) {
		t.Fatalf("start: Location %q does not begin with IdP issuer %q", loc, s.idp.issuer())
	}
	// Elide the state token in the log per the report-format ask.
	u, _ := url.Parse(loc)
	state := u.Query().Get("state")
	if state == "" {
		t.Fatal("start: no state in redirect")
	}
	t.Logf("start OK — Location=%s?...&state=<elided %d chars>",
		strings.SplitN(loc, "?", 2)[0], len(state))
}

func TestOIDCCallbackExistingUser(t *testing.T) {
	s, cleanup := oidcTestSetup(t, false)
	defer cleanup()

	// Pre-provision the user with the IdP-issued email so JIT is NOT needed.
	pw, _ := domain.HashPassword("VeryStrong#1")
	uid := uuid.New()
	tx, _ := s.p.Begin(context.Background())
	_, _ = tx.Exec(context.Background(), "SET LOCAL app.current_tenant = '"+s.tid.String()+"'")
	if _, err := tx.Exec(context.Background(),
		`INSERT INTO app_user(id, tenant_id, email, display_name, status, password_hash, version)
         VALUES ($1,$2,$3,'pre','active',$4,1)`, uid, s.tid, s.idp.email, pw); err != nil {
		tx.Rollback(context.Background())
		t.Fatal(err)
	}
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}

	state := s.freshState(t, "")
	rec := callbackJSON(s.h, s.slug, state, "any-code")
	if rec.Code != 200 {
		t.Fatalf("callback: got %d want 200: %s", rec.Code, rec.Body.String())
	}
	var tp service.TokenPair
	if err := json.Unmarshal(rec.Body.Bytes(), &tp); err != nil {
		t.Fatal(err)
	}
	if tp.AccessToken == "" || tp.RefreshToken == "" {
		t.Fatalf("callback existing-user: missing tokens: %+v", tp)
	}

	// Existing-user assertion: the row count must STILL be 1 (no JIT).
	var n int
	_ = s.p.QueryRow(context.Background(),
		`SELECT count(*) FROM app_user WHERE tenant_id=$1`, s.tid).Scan(&n)
	if n != 1 {
		t.Fatalf("existing-user callback should not JIT-provision; count=%d", n)
	}
}

func TestOIDCCallbackJITProvisions(t *testing.T) {
	s, cleanup := oidcTestSetup(t, true)
	defer cleanup()

	// No pre-provisioned user — callback must INSERT one.
	state := s.freshState(t, "")
	rec := callbackJSON(s.h, s.slug, state, "any-code")
	if rec.Code != 200 {
		t.Fatalf("callback (JIT): got %d want 200: %s", rec.Code, rec.Body.String())
	}
	var tp service.TokenPair
	if err := json.Unmarshal(rec.Body.Bytes(), &tp); err != nil {
		t.Fatal(err)
	}
	if tp.AccessToken == "" {
		t.Fatal("callback (JIT): no access_token")
	}

	// JIT assertion: a fresh app_user row exists with the IdP email.
	var n int
	if err := s.p.QueryRow(context.Background(),
		`SELECT count(*) FROM app_user WHERE tenant_id=$1 AND email=$2`,
		s.tid, s.idp.email).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("JIT should insert exactly one app_user row, got %d", n)
	}

	// external_idp / external_sub should be stamped so a future SAML/OIDC
	// connector can tell the user originated from federation.
	var extIdp, extSub *string
	if err := s.p.QueryRow(context.Background(),
		`SELECT external_idp, external_sub FROM app_user WHERE tenant_id=$1 AND email=$2`,
		s.tid, s.idp.email).Scan(&extIdp, &extSub); err != nil {
		t.Fatal(err)
	}
	if extIdp == nil || !strings.HasPrefix(*extIdp, "oidc:") {
		t.Fatalf("external_idp should be 'oidc:<issuer>', got %v", extIdp)
	}
	if extSub == nil || *extSub == "" {
		t.Fatalf("external_sub should be populated, got %v", extSub)
	}
}

func TestOIDCCallbackJITDisabledRejects(t *testing.T) {
	s, cleanup := oidcTestSetup(t, false)
	defer cleanup()

	// No pre-provisioned user AND allow_jit_provisioning=false → 403.
	state := s.freshState(t, "")
	rec := callbackJSON(s.h, s.slug, state, "any-code")
	if rec.Code != 403 {
		t.Fatalf("callback (JIT off, unknown user): want 403, got %d: %s",
			rec.Code, rec.Body.String())
	}
	// And no row should have been inserted.
	var n int
	_ = s.p.QueryRow(context.Background(),
		`SELECT count(*) FROM app_user WHERE tenant_id=$1`, s.tid).Scan(&n)
	if n != 0 {
		t.Fatalf("JIT off should not insert app_user; count=%d", n)
	}
}

func TestOIDCCallbackInvalidState(t *testing.T) {
	s, cleanup := oidcTestSetup(t, true)
	defer cleanup()

	rec := callbackJSON(s.h, s.slug, "not-a-real-state", "any-code")
	if rec.Code != 400 {
		t.Fatalf("callback (bad state): want 400, got %d: %s",
			rec.Code, rec.Body.String())
	}
}

// Silence unused-import warnings if subsets of the file are exercised.
var _ = bytes.NewReader
var _ = fmt.Sprintf
var _ = io.Copy
