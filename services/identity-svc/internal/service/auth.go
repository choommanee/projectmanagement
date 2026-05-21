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

type Auth struct {
	users    *store.Users
	sessions *store.Sessions
	signer   *libauth.Signer
	aud      AuditPublisher
}

func NewAuth(u *store.Users, s *store.Sessions, signer *libauth.Signer, aud AuditPublisher) *Auth {
	return &Auth{users: u, sessions: s, signer: signer, aud: aud}
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

	access, err := a.signer.Sign(libauth.Claims{
		Subject:  u.ID.String(),
		TenantID: u.TenantID.String(),
		Roles:    []string{},
		TTL:      15 * time.Minute,
	})
	if err != nil {
		return nil, err
	}

	refresh := randomToken(32)
	sess := store.Session{
		ID:          uuid.New(),
		UserID:      u.ID,
		TenantID:    u.TenantID,
		RefreshHash: store.HashToken(refresh),
		ExpiresAt:   time.Now().Add(30 * 24 * time.Hour),
	}
	if err := a.sessions.Create(ctx, sess); err != nil {
		return nil, err
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
		RefreshToken: refresh,
		ExpiresAt:    time.Now().Add(15 * time.Minute),
	}, nil
}

func randomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
