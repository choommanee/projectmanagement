package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"time"

	"github.com/google/uuid"

	libauth "github.com/pmplatform/libs/go/auth"
	"github.com/pmplatform/libs/go/audit"

	"github.com/pmplatform/services/identity-svc/internal/domain"
	"github.com/pmplatform/services/identity-svc/internal/store"
)

// AuditPublisher is the interface satisfied by *audit.Publisher, *audit.Fallback,
// and any other publisher that can record events.
type AuditPublisher interface {
	Publish(ctx context.Context, action string, ev audit.Event) error
}

// TokenSigner is the minimal interface Auth needs. Both *libauth.Signer
// (bootstrap, tests) and *jwt.DynamicSigner (production — refreshes the active
// key on every call so rotation takes effect without restart) satisfy it.
type TokenSigner interface {
	Sign(libauth.Claims) (string, error)
}

type Auth struct {
	users    *store.Users
	sessions *store.Sessions
	tokens   *store.RefreshTokens // nil-safe: Login only writes refresh_token when set
	mfa      *store.MFAEnrollments // nil-safe: Login branches into step-up only when set
	signer   TokenSigner
	aud      AuditPublisher
	// refreshTTL is the lifetime of the issued refresh_token row. Mirrors
	// the value Refresh uses so a rotated token expires on the same cadence
	// as one freshly minted at login.
	refreshTTL time.Duration
}

func NewAuth(u *store.Users, s *store.Sessions, signer TokenSigner, aud AuditPublisher) *Auth {
	return &Auth{users: u, sessions: s, signer: signer, aud: aud, refreshTTL: 720 * time.Hour}
}

// WithRefreshTokens attaches the refresh_token store + TTL so Login dual-writes
// the new rotation-capable row alongside the legacy `session` row. Returns the
// receiver for fluent wiring.
func (a *Auth) WithRefreshTokens(t *store.RefreshTokens, ttl time.Duration) *Auth {
	a.tokens = t
	if ttl > 0 {
		a.refreshTTL = ttl
	}
	return a
}

// WithMFA attaches the mfa_enrollment store so Login can detect a confirmed
// enrollment and return a step-up token instead of a full session.
func (a *Auth) WithMFA(m *store.MFAEnrollments) *Auth {
	a.mfa = m
	return a
}

// IssueSession is the post-MFA path. It mints the full access/refresh pair
// for an already-authenticated user, mirroring the legacy Login tail. The
// challenge handler calls this once the second factor has cleared.
func (a *Auth) IssueSession(ctx context.Context, tenantID, userID uuid.UUID) (*TokenPair, error) {
	tp, err := a.issueTokensFor(ctx, tenantID, userID)
	if err != nil {
		return nil, err
	}
	if a.aud != nil {
		_ = a.aud.Publish(ctx, "user.login", audit.Event{
			TenantID: tenantID.String(),
			UserID:   userID.String(),
			Result:   "success",
			Meta:     map[string]any{"via": "mfa_challenge"},
		})
	}
	return tp, nil
}

// LookupEmail returns the user's email for a given (tenant, user). Used by
// the MFA enroll handler to build the otpauth label.
func (a *Auth) LookupEmail(ctx context.Context, tid, uid uuid.UUID) (string, error) {
	u, err := a.users.FindByID(ctx, tid, uid)
	if err != nil {
		return "", err
	}
	return u.Email, nil
}

// LookupPasswordHash returns the user's bcrypt hash. Used by the MFA
// disable handler to re-verify the current password before tearing down
// the enrollment row.
func (a *Auth) LookupPasswordHash(ctx context.Context, tid, uid uuid.UUID) (string, error) {
	u, err := a.users.FindByID(ctx, tid, uid)
	if err != nil {
		return "", err
	}
	return u.PasswordHash, nil
}

type LoginInput struct {
	TenantID        uuid.UUID
	Email, Password string
}

type TokenPair struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
}

// LoginResponse generalizes the Login result to either a full token pair
// (the happy, no-MFA case) or a step-up challenge (MFA confirmed for this
// user). Callers JSON-encode the struct directly; mfa_token / mfa_required
// are omitted in the no-MFA case via the omitempty tags.
type LoginResponse struct {
	*TokenPair
	MFARequired bool   `json:"mfa_required,omitempty"`
	MFAToken    string `json:"mfa_token,omitempty"`
}

// MFAStepUpTTL is the lifetime of the short-lived JWT returned when a
// confirmed enrollment forces step-up. Deliberately tight: 1 minute is
// enough for the user to tap a code, not enough to be useful if leaked.
const MFAStepUpTTL = time.Minute

// MFAStepUpRoleSentinel is what we stick in the Roles slice of the step-up
// token so a normal libauth.Verifier sees a non-empty roles claim and the
// challenge handler can distinguish a step-up token from a real access
// token. We don't add a custom claim because libauth.Claims is fixed-shape;
// the sentinel + 1-minute TTL is sufficient for Phase 1.
const MFAStepUpRoleSentinel = "_mfa_pending"

func (a *Auth) Login(ctx context.Context, in LoginInput) (*LoginResponse, error) {
	u, err := a.users.FindByEmail(ctx, in.TenantID, in.Email)
	if err != nil {
		if a.aud != nil {
			_ = a.aud.Publish(ctx, "user.login", audit.Event{
				TenantID: in.TenantID.String(),
				Result:   "denied",
				Meta:     map[string]any{"email": in.Email},
			})
		}
		return nil, domain.ErrInvalidCreds
	}
	if u.Status != domain.StatusActive {
		if a.aud != nil {
			_ = a.aud.Publish(ctx, "user.login", audit.Event{
				TenantID: in.TenantID.String(),
				UserID:   u.ID.String(),
				Result:   "denied",
				Meta:     map[string]any{"email": in.Email, "reason": "inactive"},
			})
		}
		return nil, domain.ErrInvalidCreds
	}
	if err := domain.CheckPassword(u.PasswordHash, in.Password); err != nil {
		if a.aud != nil {
			_ = a.aud.Publish(ctx, "user.login", audit.Event{
				TenantID: in.TenantID.String(),
				UserID:   u.ID.String(),
				Result:   "denied",
				Meta:     map[string]any{"email": in.Email},
			})
		}
		return nil, err
	}

	// Step-up branch: if the user has a CONFIRMED MFA enrollment, return a
	// short-lived mfa_token instead of a real session. The client must
	// follow up with /v1/auth/mfa/challenge to exchange the mfa_token + a
	// TOTP/backup code for a full session. We deliberately do NOT log
	// "user.login=success" here — the audit event fires once the challenge
	// completes.
	if a.mfa != nil {
		row, err := a.mfa.FindByUserUnscoped(ctx, u.ID)
		if err == nil && row.IsConfirmed() {
			mfaTok, err := a.signer.Sign(libauth.Claims{
				Subject:  u.ID.String(),
				TenantID: u.TenantID.String(),
				Roles:    []string{MFAStepUpRoleSentinel},
				TTL:      MFAStepUpTTL,
			})
			if err != nil {
				return nil, err
			}
			if a.aud != nil {
				_ = a.aud.Publish(ctx, "user.login", audit.Event{
					TenantID: u.TenantID.String(),
					UserID:   u.ID.String(),
					Result:   "mfa_required",
				})
			}
			return &LoginResponse{
				MFARequired: true,
				MFAToken:    mfaTok,
			}, nil
		}
	}

	tp, err := a.issueTokensFor(ctx, u.TenantID, u.ID)
	if err != nil {
		return nil, err
	}

	if a.aud != nil {
		_ = a.aud.Publish(ctx, "user.login", audit.Event{
			TenantID: u.TenantID.String(),
			UserID:   u.ID.String(),
			Result:   "success",
		})
	}

	return &LoginResponse{TokenPair: tp}, nil
}

// issueTokensFor mints the access JWT + refresh token pair and writes the
// legacy session row in parallel. Shared by the no-MFA Login path and the
// post-challenge IssueSession path so the two flows are guaranteed to
// produce identical session shapes.
func (a *Auth) issueTokensFor(ctx context.Context, tenantID, userID uuid.UUID) (*TokenPair, error) {
	roles, err := a.users.RolesForUser(ctx, tenantID, userID)
	if err != nil {
		return nil, err
	}

	access, err := a.signer.Sign(libauth.Claims{
		Subject:  userID.String(),
		TenantID: tenantID.String(),
		Roles:    roles,
		TTL:      15 * time.Minute,
	})
	if err != nil {
		return nil, err
	}

	// Two parallel writes by design:
	//   * legacy `session` table (kept until callers stop reading it)
	//   * new `refresh_token` table that supports rotation + theft detection
	//
	// When the refresh_token store is wired we hand its plaintext back to the
	// client; otherwise fall back to the legacy opaque token. This keeps
	// pre-Plan#6 test setups working unchanged.
	legacy := randomToken(32)
	sess := store.Session{
		ID:          uuid.New(),
		UserID:      userID,
		TenantID:    tenantID,
		RefreshHash: store.HashToken(legacy),
		ExpiresAt:   time.Now().Add(a.refreshTTL),
	}
	if err := a.sessions.Create(ctx, sess); err != nil {
		return nil, err
	}

	refreshOut := legacy
	if a.tokens != nil {
		plaintext, hash, err := domain.MintRefreshToken()
		if err != nil {
			return nil, err
		}
		row := &domain.RefreshToken{
			TenantID:  tenantID,
			UserID:    userID,
			TokenHash: hash,
			FamilyID:  uuid.New(), // fresh family per login
			ExpiresAt: time.Now().Add(a.refreshTTL),
		}
		if err := a.tokens.Insert(ctx, row); err != nil {
			return nil, err
		}
		refreshOut = plaintext
	}

	return &TokenPair{
		AccessToken:  access,
		RefreshToken: refreshOut,
		ExpiresAt:    time.Now().Add(15 * time.Minute),
	}, nil
}

func randomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
