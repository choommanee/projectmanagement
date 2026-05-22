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

type LoginInput struct {
	TenantID        uuid.UUID
	Email, Password string
}

type TokenPair struct {
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	ExpiresAt    time.Time `json:"expires_at"`
}

func (a *Auth) Login(ctx context.Context, in LoginInput) (*TokenPair, error) {
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

	roles, err := a.users.RolesForUser(ctx, u.TenantID, u.ID)
	if err != nil {
		return nil, err
	}

	access, err := a.signer.Sign(libauth.Claims{
		Subject:  u.ID.String(),
		TenantID: u.TenantID.String(),
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
		UserID:      u.ID,
		TenantID:    u.TenantID,
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
			TenantID:  u.TenantID,
			UserID:    u.ID,
			TokenHash: hash,
			FamilyID:  uuid.New(), // fresh family per login
			ExpiresAt: time.Now().Add(a.refreshTTL),
		}
		if err := a.tokens.Insert(ctx, row); err != nil {
			return nil, err
		}
		refreshOut = plaintext
	}

	if a.aud != nil {
		_ = a.aud.Publish(ctx, "user.login", audit.Event{
			TenantID: u.TenantID.String(),
			UserID:   u.ID.String(),
			Result:   "success",
		})
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
