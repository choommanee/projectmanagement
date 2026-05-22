// Package service — OIDC IdP federation (Plan #6 Task 5).
//
// Flow:
//
//  1. Admin POSTs an sso_config row (client_id + client_secret + issuer_url).
//     The secret is wrapped with the same envelope-encryption helper used by
//     MFA (HKDF-derived per-tenant key, AES-256-GCM); plaintext never lands
//     on disk.
//  2. Browser hits GET /v1/auth/oidc/{tenant_slug}/start?provider=<config_id>.
//     We mint a signed-state JWT (5-minute TTL) carrying {tenant_id,
//     config_id, redirect_after} so the callback can recover them without a
//     server-side session cache, then 302 to the IdP's authorization endpoint.
//  3. IdP redirects back to GET /v1/auth/oidc/{tenant_slug}/callback. We
//     verify the state JWT, exchange the code for an ID token via
//     coreos/go-oidc + golang.org/x/oauth2, extract email/sub/name/groups
//     per the row's attribute_map, look the user up (or JIT-provision when
//     allow_jit_provisioning = true), and mint the standard access+refresh
//     pair via Auth.IssueSession.
//
// Per-instance ABAC for sso_config is intentionally out of scope here (see
// Plan #6 Task 6); admin endpoints use resource "*" with the new
// `tenant.sso.configure` action.
package service

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"

	oidc "github.com/coreos/go-oidc/v3/oidc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/crypto/hkdf"
	"golang.org/x/oauth2"

	"github.com/pmplatform/libs/go/audit"

	"github.com/pmplatform/services/identity-svc/internal/domain"
	"github.com/pmplatform/services/identity-svc/internal/store"
)

// ssoHKDFInfo distinguishes the OIDC client-secret key from the MFA TOTP
// key. Both derive from the same master concept but live in different envs
// (MFA_MASTER_KEY vs SSO_MASTER_KEY); using a distinct `info` label means
// even if an operator accidentally reused the same hex value across both
// envs the derived data keys are still independent.
const ssoHKDFInfo = "sso_secret_v1"

// SSOStateTTL bounds the lifetime of the signed-state JWT returned in the
// /start redirect. Tight (5 min) on purpose: long enough for the user to
// authenticate at the IdP, short enough that a leaked redirect URL doesn't
// remain a useful attack surface.
const SSOStateTTL = 5 * time.Minute

// OIDCConfigInput is the body shape accepted by the create endpoint. The
// service encrypts client_secret before handing the row to the store.
type OIDCConfigInput struct {
	IssuerURL            string            `json:"issuer_url"`
	ClientID             string            `json:"client_id"`
	ClientSecret         string            `json:"client_secret"`
	RedirectURI          string            `json:"redirect_uri"`
	Scopes               []string          `json:"scopes"`
	AttributeMap         map[string]string `json:"attribute_map"`
	AllowJITProvisioning bool              `json:"allow_jit_provisioning"`
	DefaultRole          string            `json:"default_role"`
	Enabled              *bool             `json:"enabled"`
}

// OIDCConfigPatch is the partial body accepted by the update endpoint. All
// fields are pointers so unset = "leave as is".
type OIDCConfigPatch struct {
	IssuerURL            *string            `json:"issuer_url"`
	ClientID             *string            `json:"client_id"`
	ClientSecret         *string            `json:"client_secret"`
	RedirectURI          *string            `json:"redirect_uri"`
	Scopes               *[]string          `json:"scopes"`
	AttributeMap         *map[string]string `json:"attribute_map"`
	AllowJITProvisioning *bool              `json:"allow_jit_provisioning"`
	DefaultRole          *string            `json:"default_role"`
	Enabled              *bool              `json:"enabled"`
}

// OIDCConfigResponse is the safe-for-display projection: client_secret_encrypted
// is OMITTED so admin reads can never round-trip the ciphertext back out.
type OIDCConfigResponse struct {
	ID                   uuid.UUID         `json:"id"`
	TenantID             uuid.UUID         `json:"tenant_id"`
	Provider             string            `json:"provider"`
	IssuerURL            string            `json:"issuer_url"`
	ClientID             string            `json:"client_id"`
	RedirectURI          string            `json:"redirect_uri"`
	Scopes               []string          `json:"scopes"`
	AttributeMap         map[string]string `json:"attribute_map"`
	AllowJITProvisioning bool              `json:"allow_jit_provisioning"`
	DefaultRole          string            `json:"default_role,omitempty"`
	Enabled              bool              `json:"enabled"`
	CreatedAt            time.Time         `json:"created_at"`
	UpdatedAt            time.Time         `json:"updated_at"`
}

// projectConfig is the safe-display projector. Centralized so we never
// accidentally serialize ClientSecretEncrypted.
func projectConfig(c *domain.SSOConfig) OIDCConfigResponse {
	return OIDCConfigResponse{
		ID:                   c.ID,
		TenantID:             c.TenantID,
		Provider:             c.Provider,
		IssuerURL:            c.IssuerURL,
		ClientID:             c.ClientID,
		RedirectURI:          c.RedirectURI,
		Scopes:               c.Scopes,
		AttributeMap:         c.AttributeMap,
		AllowJITProvisioning: c.AllowJITProvisioning,
		DefaultRole:          c.DefaultRole,
		Enabled:              c.Enabled,
		CreatedAt:            c.CreatedAt,
		UpdatedAt:            c.UpdatedAt,
	}
}

// ssoCrypto wraps SSO_MASTER_KEY for envelope-encrypting OIDC client_secrets.
// Identical shape to mfaCrypto (Task 4) — copy-paste was a deliberate
// tradeoff over premature generalization; the helper is small and the two
// services rotate independently in practice.
type ssoCrypto struct {
	master []byte // 32 bytes
}

func newSSOCrypto(masterHex string) (*ssoCrypto, error) {
	if masterHex == "" {
		return nil, domain.ErrSSODisabled
	}
	b, err := decodeHex32(masterHex)
	if err != nil {
		return nil, err
	}
	return &ssoCrypto{master: b}, nil
}

func (s *ssoCrypto) deriveKey(tenantID uuid.UUID) ([]byte, error) {
	tb, _ := tenantID.MarshalBinary()
	h := hkdf.New(sha256.New, s.master, tb, []byte(ssoHKDFInfo))
	out := make([]byte, 32)
	if _, err := io.ReadFull(h, out); err != nil {
		return nil, err
	}
	return out, nil
}

// stateSecret returns a stable HMAC key for the state JWT. The state token
// crosses the tenant boundary at /start (the tenant_id is in the payload,
// not implicit yet), so we derive a single per-master key independent of
// tenant. Rotating SSO_MASTER_KEY invalidates any in-flight state JWTs.
func (s *ssoCrypto) stateSecret() ([]byte, error) {
	h := hkdf.New(sha256.New, s.master, []byte("sso_state_v1"), []byte("hmac"))
	out := make([]byte, 32)
	if _, err := io.ReadFull(h, out); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *ssoCrypto) Encrypt(plaintext []byte, tenantID uuid.UUID) ([]byte, error) {
	key, err := s.deriveKey(tenantID)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	ct := gcm.Seal(nil, nonce, plaintext, nil)
	out := make([]byte, 0, len(nonce)+len(ct))
	out = append(out, nonce...)
	out = append(out, ct...)
	return out, nil
}

func (s *ssoCrypto) Decrypt(blob []byte, tenantID uuid.UUID) ([]byte, error) {
	key, err := s.deriveKey(tenantID)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(blob) < gcm.NonceSize() {
		return nil, errors.New("sso ciphertext too short")
	}
	nonce := blob[:gcm.NonceSize()]
	ct := blob[gcm.NonceSize():]
	return gcm.Open(nil, nonce, ct, nil)
}

// decodeHex32 parses a 64-char hex string into 32 bytes. Hand-rolled (vs
// encoding/hex) so the error message names SSO_MASTER_KEY directly, matching
// the MFA_MASTER_KEY ergonomics from Task 4.
func decodeHex32(s string) ([]byte, error) {
	if len(s) != 64 {
		return nil, errors.New("SSO_MASTER_KEY: expected 32 bytes (64 hex chars)")
	}
	b := make([]byte, 32)
	for i := 0; i < 32; i++ {
		hi, err1 := hexVal(s[2*i])
		lo, err2 := hexVal(s[2*i+1])
		if err1 != nil || err2 != nil {
			return nil, errors.New("SSO_MASTER_KEY: expected hex")
		}
		b[i] = hi<<4 | lo
	}
	return b, nil
}

func hexVal(c byte) (byte, error) {
	switch {
	case c >= '0' && c <= '9':
		return c - '0', nil
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10, nil
	case c >= 'A' && c <= 'F':
		return c - 'A' + 10, nil
	}
	return 0, errors.New("not hex")
}

// OIDC is the orchestrator for federation. It owns the crypto helper,
// resolves issuer metadata via go-oidc, and delegates session minting to
// Auth.IssueSession (so federated and password-auth sessions are
// indistinguishable downstream).
type OIDC struct {
	configs *store.SSOConfigs
	users   *store.Users
	auth    *Auth
	pool    *pgxpool.Pool // shared with the stores; used directly for the role_assignment INSERT during JIT
	crypto  *ssoCrypto
	aud     AuditPublisher
	webURL  string // base for the post-callback redirect; e.g. http://localhost:3000

	// providerCache memoizes per-issuer go-oidc.Provider lookups. We DON'T
	// cache across config edits because the issuer URL is the cache key and
	// changing it produces a different key naturally.
	providerCache map[string]*oidc.Provider
}

// NewOIDC constructs the service. masterHex is SSO_MASTER_KEY; an empty
// value returns ErrSSODisabled so the caller can decide whether to
// short-circuit endpoint mounting (production) or fall through (dev).
func NewOIDC(
	cfgs *store.SSOConfigs,
	users *store.Users,
	auth *Auth,
	pool *pgxpool.Pool,
	masterHex, webURL string,
	aud AuditPublisher,
) (*OIDC, error) {
	c, err := newSSOCrypto(masterHex)
	if err != nil {
		return nil, err
	}
	if webURL == "" {
		webURL = "http://localhost:3000"
	}
	return &OIDC{
		configs:       cfgs,
		users:         users,
		auth:          auth,
		pool:          pool,
		crypto:        c,
		aud:           aud,
		webURL:        strings.TrimRight(webURL, "/"),
		providerCache: map[string]*oidc.Provider{},
	}, nil
}

// CreateConfig wraps the store.Create with secret encryption. Returns the
// safe projection (no encrypted blob).
func (o *OIDC) CreateConfig(ctx context.Context, tid uuid.UUID, in OIDCConfigInput) (*OIDCConfigResponse, error) {
	if in.IssuerURL == "" || in.ClientID == "" || in.ClientSecret == "" || in.RedirectURI == "" {
		return nil, errors.New("issuer_url, client_id, client_secret, redirect_uri required")
	}
	enc, err := o.crypto.Encrypt([]byte(in.ClientSecret), tid)
	if err != nil {
		return nil, err
	}
	scopes := in.Scopes
	if len(scopes) == 0 {
		scopes = []string{"openid", "profile", "email"}
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	row := &domain.SSOConfig{
		TenantID:              tid,
		Provider:              "oidc",
		IssuerURL:             in.IssuerURL,
		ClientID:              in.ClientID,
		ClientSecretEncrypted: enc,
		RedirectURI:           in.RedirectURI,
		Scopes:                scopes,
		AttributeMap:          in.AttributeMap,
		AllowJITProvisioning:  in.AllowJITProvisioning,
		DefaultRole:           in.DefaultRole,
		Enabled:               enabled,
	}
	if err := o.configs.Create(ctx, row); err != nil {
		return nil, err
	}
	if o.aud != nil {
		_ = o.aud.Publish(ctx, "sso.config.create", audit.Event{
			TenantID: tid.String(),
			Result:   "success",
			Meta:     map[string]any{"config_id": row.ID.String(), "issuer_url": in.IssuerURL},
		})
	}
	out := projectConfig(row)
	return &out, nil
}

// UpdateConfig applies a partial patch. ClientSecret (when present) is
// re-encrypted in place. Returns the refreshed projection.
func (o *OIDC) UpdateConfig(ctx context.Context, tid, id uuid.UUID, p OIDCConfigPatch) (*OIDCConfigResponse, error) {
	patch := store.SSOConfigPatch{
		IssuerURL:            p.IssuerURL,
		ClientID:             p.ClientID,
		RedirectURI:          p.RedirectURI,
		Scopes:               p.Scopes,
		AttributeMap:         p.AttributeMap,
		AllowJITProvisioning: p.AllowJITProvisioning,
		DefaultRole:          p.DefaultRole,
		Enabled:              p.Enabled,
	}
	if p.ClientSecret != nil && *p.ClientSecret != "" {
		enc, err := o.crypto.Encrypt([]byte(*p.ClientSecret), tid)
		if err != nil {
			return nil, err
		}
		patch.ClientSecretEncrypted = &enc
	}
	if err := o.configs.Update(ctx, tid, id, patch); err != nil {
		return nil, err
	}
	row, err := o.configs.FindByIDUnscoped(ctx, id)
	if err != nil {
		return nil, err
	}
	if row.TenantID != tid {
		return nil, domain.ErrSSOConfigNotFound
	}
	if o.aud != nil {
		_ = o.aud.Publish(ctx, "sso.config.update", audit.Event{
			TenantID: tid.String(),
			Result:   "success",
			Meta:     map[string]any{"config_id": id.String()},
		})
	}
	out := projectConfig(row)
	return &out, nil
}

// DeleteConfig drops the row.
func (o *OIDC) DeleteConfig(ctx context.Context, tid, id uuid.UUID) error {
	if err := o.configs.Delete(ctx, tid, id); err != nil {
		return err
	}
	if o.aud != nil {
		_ = o.aud.Publish(ctx, "sso.config.delete", audit.Event{
			TenantID: tid.String(),
			Result:   "success",
			Meta:     map[string]any{"config_id": id.String()},
		})
	}
	return nil
}

// ListConfigs returns the tenant's configs as safe projections.
func (o *OIDC) ListConfigs(ctx context.Context, tid uuid.UUID) ([]OIDCConfigResponse, error) {
	rows, err := o.configs.List(ctx, tid)
	if err != nil {
		return nil, err
	}
	out := make([]OIDCConfigResponse, 0, len(rows))
	for i := range rows {
		out = append(out, projectConfig(&rows[i]))
	}
	return out, nil
}

// StartResult is what the /start handler renders into a 302.
type StartResult struct {
	RedirectURL string
}

// Start builds the IdP authorization URL. tenant_slug is used to derive the
// tenant_id; config_id picks the specific sso_config row.
func (o *OIDC) Start(ctx context.Context, tenantSlug, configIDStr, redirectAfter string) (*StartResult, error) {
	cid, err := uuid.Parse(configIDStr)
	if err != nil {
		return nil, errors.New("bad provider id")
	}
	tid, err := o.users.FindTenantIDBySlug(ctx, tenantSlug)
	if err != nil {
		return nil, err
	}
	cfg, err := o.configs.FindByIDUnscoped(ctx, cid)
	if err != nil {
		return nil, err
	}
	if cfg.TenantID != tid {
		// Don't disclose existence across tenants: same shape as not-found.
		return nil, domain.ErrSSOConfigNotFound
	}
	if !cfg.Enabled {
		return nil, domain.ErrSSOConfigNotFound
	}
	provider, err := o.resolveProvider(ctx, cfg.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("provider metadata: %w", err)
	}
	secret, err := o.crypto.Decrypt(cfg.ClientSecretEncrypted, cfg.TenantID)
	if err != nil {
		return nil, fmt.Errorf("decrypt client secret: %w", err)
	}
	oauthCfg := &oauth2.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: string(secret),
		Endpoint:     provider.Endpoint(),
		RedirectURL:  cfg.RedirectURI,
		Scopes:       cfg.Scopes,
	}
	state, err := o.signState(stateClaims{
		TenantID:      cfg.TenantID.String(),
		ConfigID:      cfg.ID.String(),
		RedirectAfter: redirectAfter,
		IssuedAt:      time.Now().Unix(),
		ExpiresAt:     time.Now().Add(SSOStateTTL).Unix(),
	})
	if err != nil {
		return nil, err
	}
	return &StartResult{RedirectURL: oauthCfg.AuthCodeURL(state)}, nil
}

// CallbackResult is the outcome of a successful callback: a fresh access +
// refresh pair plus the original redirect_after destination (so the handler
// can decide JSON vs 302 + URL-encoded redirect).
type CallbackResult struct {
	Tokens         *TokenPair
	RedirectAfter  string
	JITProvisioned bool
}

// Callback completes the OIDC flow. It verifies the state JWT, exchanges the
// auth code, validates the ID token, runs (or skips) JIT, and mints a session.
func (o *OIDC) Callback(ctx context.Context, tenantSlug, code, state string) (*CallbackResult, error) {
	st, err := o.verifyState(state)
	if err != nil {
		return nil, domain.ErrSSOStateInvalid
	}
	tid, err := o.users.FindTenantIDBySlug(ctx, tenantSlug)
	if err != nil {
		return nil, err
	}
	stTID, err := uuid.Parse(st.TenantID)
	if err != nil || stTID != tid {
		return nil, domain.ErrSSOStateInvalid
	}
	cid, err := uuid.Parse(st.ConfigID)
	if err != nil {
		return nil, domain.ErrSSOStateInvalid
	}
	cfg, err := o.configs.FindByIDUnscoped(ctx, cid)
	if err != nil {
		return nil, err
	}
	if cfg.TenantID != tid {
		return nil, domain.ErrSSOConfigNotFound
	}
	provider, err := o.resolveProvider(ctx, cfg.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("provider metadata: %w", err)
	}
	secret, err := o.crypto.Decrypt(cfg.ClientSecretEncrypted, cfg.TenantID)
	if err != nil {
		return nil, fmt.Errorf("decrypt client secret: %w", err)
	}
	oauthCfg := &oauth2.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: string(secret),
		Endpoint:     provider.Endpoint(),
		RedirectURL:  cfg.RedirectURI,
		Scopes:       cfg.Scopes,
	}
	tok, err := oauthCfg.Exchange(ctx, code)
	if err != nil {
		return nil, fmt.Errorf("oauth2 exchange: %w", err)
	}
	rawID, _ := tok.Extra("id_token").(string)
	if rawID == "" {
		return nil, domain.ErrSSOIDTokenInvalid
	}
	verifier := provider.Verifier(&oidc.Config{ClientID: cfg.ClientID})
	idTok, err := verifier.Verify(ctx, rawID)
	if err != nil {
		return nil, domain.ErrSSOIDTokenInvalid
	}
	var claims map[string]any
	if err := idTok.Claims(&claims); err != nil {
		return nil, domain.ErrSSOIDTokenInvalid
	}
	email := pickString(claims, cfg.AttrKey("email"))
	if email == "" {
		return nil, domain.ErrSSOMissingEmail
	}
	sub := pickString(claims, cfg.AttrKey("sub"))
	if sub == "" {
		sub = idTok.Subject
	}
	displayName := pickString(claims, cfg.AttrKey("name"))
	if displayName == "" {
		displayName = email
	}

	user, jitProvisioned, err := o.resolveOrProvisionUser(ctx, cfg, email, sub, displayName)
	if err != nil {
		if o.aud != nil {
			_ = o.aud.Publish(ctx, "sso.login", audit.Event{
				TenantID: tid.String(),
				Result:   "denied",
				Meta:     map[string]any{"email": email, "reason": err.Error()},
			})
		}
		return nil, err
	}

	tp, err := o.auth.IssueSession(ctx, tid, user.ID)
	if err != nil {
		return nil, err
	}
	if o.aud != nil {
		_ = o.aud.Publish(ctx, "sso.login", audit.Event{
			TenantID: tid.String(),
			UserID:   user.ID.String(),
			Result:   "success",
			Meta: map[string]any{
				"config_id":       cid.String(),
				"jit_provisioned": jitProvisioned,
			},
		})
	}
	return &CallbackResult{
		Tokens:         tp,
		RedirectAfter:  st.RedirectAfter,
		JITProvisioned: jitProvisioned,
	}, nil
}

// resolveOrProvisionUser does the FindByEmail + (optional) JIT INSERT.
// Returns the resolved User row + a bool indicating whether we just created
// it (so the audit/caller can distinguish first-login from returning user).
func (o *OIDC) resolveOrProvisionUser(
	ctx context.Context,
	cfg *domain.SSOConfig,
	email, sub, displayName string,
) (*domain.User, bool, error) {
	existing, err := o.users.FindByEmail(ctx, cfg.TenantID, email)
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, domain.ErrNotFound) {
		return nil, false, err
	}
	if !cfg.AllowJITProvisioning {
		return nil, false, domain.ErrSSOJITDisabled
	}
	// JIT path. password_hash is a bcrypt of a random 32-byte string —
	// the user can't ever log in by password (no recovery channel hands
	// out the plaintext), but the column is NOT NULL friendly for any
	// existing constraints.
	junk := make([]byte, 32)
	if _, err := rand.Read(junk); err != nil {
		return nil, false, err
	}
	hash, err := bcrypt.GenerateFromPassword(junk, 12)
	if err != nil {
		return nil, false, err
	}
	u := &domain.User{
		ID:           uuid.New(),
		TenantID:     cfg.TenantID,
		Email:        email,
		DisplayName:  displayName,
		Status:       domain.StatusActive,
		PasswordHash: string(hash),
		ExternalIDP:  "oidc:" + cfg.IssuerURL,
		ExternalSub:  sub,
		Version:      1,
	}
	if err := o.users.Create(ctx, u); err != nil {
		return nil, false, err
	}
	if cfg.DefaultRole != "" {
		// Best-effort: a missing role name leaves the user role-less,
		// but the session still mints. An admin can fix it up later
		// without losing the in-flight login.
		_ = o.assignDefaultRole(ctx, cfg.TenantID, u.ID, cfg.DefaultRole)
	}
	return u, true, nil
}

// assignDefaultRole inserts a role_assignment row for the JIT user. The role
// must already exist in the tenant (the OIDC service does NOT auto-create
// roles — that's an explicit admin operation). Returns an error when the
// role name doesn't exist or the INSERT fails; caller treats as non-fatal.
func (o *OIDC) assignDefaultRole(ctx context.Context, tid, uid uuid.UUID, roleName string) error {
	if o.pool == nil {
		return errors.New("oidc: no pool wired for role assignment")
	}
	tx, err := o.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String())); err != nil {
		return err
	}
	var roleID uuid.UUID
	if err := tx.QueryRow(ctx, `
        SELECT id FROM role WHERE tenant_id = $1 AND name = $2`, tid, roleName).Scan(&roleID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
        INSERT INTO role_assignment(tenant_id, user_id, role_id)
        VALUES ($1,$2,$3)
        ON CONFLICT (tenant_id, user_id, role_id, scope_type, scope_id) DO NOTHING`,
		tid, uid, roleID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// pickString reads a single string-shaped claim from the ID-token payload.
// Returns "" when the key is missing or has a non-string shape.
func pickString(m map[string]any, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// resolveProvider memoizes go-oidc provider discovery per issuer URL. Each
// IdP exposes a /.well-known/openid-configuration; the result is small but
// the round-trip per request would be wasteful.
func (o *OIDC) resolveProvider(ctx context.Context, issuer string) (*oidc.Provider, error) {
	if p, ok := o.providerCache[issuer]; ok {
		return p, nil
	}
	p, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, err
	}
	o.providerCache[issuer] = p
	return p, nil
}

// BuildCompleteRedirect builds the URL the callback handler redirects to
// when the caller wants a browser flow (not JSON). The token pair is
// URL-encoded into query params.
func (o *OIDC) BuildCompleteRedirect(redirectAfter string, tp *TokenPair) string {
	base := o.webURL + "/auth/complete"
	q := url.Values{}
	q.Set("access", tp.AccessToken)
	q.Set("refresh", tp.RefreshToken)
	if redirectAfter != "" {
		q.Set("next", redirectAfter)
	}
	return base + "?" + q.Encode()
}

// stateClaims is the payload of the state JWT.
type stateClaims struct {
	TenantID      string `json:"tid"`
	ConfigID      string `json:"cid"`
	RedirectAfter string `json:"redir,omitempty"`
	IssuedAt      int64  `json:"iat"`
	ExpiresAt     int64  `json:"exp"`
}

// signState produces a compact HMAC-SHA256-signed token of the form
// base64url(payload) "." base64url(hmac). HMAC is sufficient because the
// state never leaves identity-svc — it's bounced via the IdP redirect but
// only ever validated by us.
func (o *OIDC) signState(c stateClaims) (string, error) {
	key, err := o.crypto.stateSecret()
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	body := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(body))
	tag := mac.Sum(nil)
	return body + "." + base64.RawURLEncoding.EncodeToString(tag), nil
}

// verifyState parses & HMAC-verifies a state token produced by signState.
func (o *OIDC) verifyState(tok string) (*stateClaims, error) {
	parts := strings.SplitN(tok, ".", 2)
	if len(parts) != 2 {
		return nil, domain.ErrSSOStateInvalid
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, domain.ErrSSOStateInvalid
	}
	got, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, domain.ErrSSOStateInvalid
	}
	key, err := o.crypto.stateSecret()
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(parts[0]))
	want := mac.Sum(nil)
	if subtle.ConstantTimeCompare(want, got) != 1 {
		return nil, domain.ErrSSOStateInvalid
	}
	var c stateClaims
	if err := json.Unmarshal(body, &c); err != nil {
		return nil, domain.ErrSSOStateInvalid
	}
	if c.ExpiresAt < time.Now().Unix() {
		return nil, domain.ErrSSOStateInvalid
	}
	return &c, nil
}
