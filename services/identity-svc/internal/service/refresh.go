package service

import (
	"context"
	"os"
	"time"

	"github.com/rs/zerolog/log"

	libauth "github.com/pmplatform/libs/go/auth"
	"github.com/pmplatform/libs/go/audit"

	"github.com/pmplatform/services/identity-svc/internal/domain"
	"github.com/pmplatform/services/identity-svc/internal/store"
)

// Refresh handles refresh-token rotation with theft detection.
//
// Successful rotation revokes the presented token and issues a new pair
// linked by family_id. Presenting a token whose row is already revoked
// signals a leak: the WHOLE family is revoked and 401 returned.
type Refresh struct {
	users   *store.Users
	tokens  *store.RefreshTokens
	signer  TokenSigner
	aud     AuditPublisher
	ttl     time.Duration // refresh-token TTL (default 720h / 30d)
	accTTL  time.Duration // access-token TTL (default 15m, mirrors Login)
}

// NewRefresh wires the rotation flow. ttl defaults to 720h (30d) when the
// env REFRESH_TOKEN_TTL is empty or unparseable; accTTL is fixed at 15m
// (same as Login) so the issued access tokens stay consistent.
func NewRefresh(u *store.Users, t *store.RefreshTokens, signer TokenSigner, aud AuditPublisher) *Refresh {
	ttl := 720 * time.Hour
	if v := os.Getenv("REFRESH_TOKEN_TTL"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			ttl = d
		} else {
			log.Warn().Str("env", "REFRESH_TOKEN_TTL").Str("value", v).Msg("invalid duration; using 720h default")
		}
	}
	return &Refresh{users: u, tokens: t, signer: signer, aud: aud, ttl: ttl, accTTL: 15 * time.Minute}
}

// TTL exposes the configured refresh-token lifetime (for Login wiring).
func (r *Refresh) TTL() time.Duration { return r.ttl }

// Rotate validates the presented refresh token and, on success, mints a new
// pair. Failure modes (unknown / expired / reuse) all surface as
// domain.ErrRefreshTokenInvalid so the HTTP layer responds with an
// undifferentiated 401.
func (r *Refresh) Rotate(ctx context.Context, presented string) (*TokenPair, error) {
	hash, err := domain.HashRefreshToken(presented)
	if err != nil {
		return nil, domain.ErrRefreshTokenInvalid
	}
	row, err := r.tokens.FindByHash(ctx, hash)
	if err != nil {
		return nil, domain.ErrRefreshTokenInvalid
	}

	// Reuse detection: a presented-but-already-revoked row means an attacker
	// captured the token and the legitimate client (or attacker) rotated
	// after them. Either way the family is compromised.
	if row.RevokedAt != nil {
		n, ferr := r.tokens.RevokeFamily(ctx, row.TenantID, row.FamilyID)
		log.Warn().
			Str("tenant_id", row.TenantID.String()).
			Str("user_id", row.UserID.String()).
			Str("family_id", row.FamilyID.String()).
			Int64("rows_revoked", n).
			Err(ferr).
			Msg("refresh-token reuse detected — family revoked")
		if r.aud != nil {
			_ = r.aud.Publish(ctx, "user.refresh", audit.Event{
				TenantID: row.TenantID.String(),
				UserID:   row.UserID.String(),
				Result:   "denied",
				Meta: map[string]any{
					"reason":    "reuse_detected",
					"family_id": row.FamilyID.String(),
				},
			})
		}
		return nil, domain.ErrRefreshTokenInvalid
	}

	if time.Now().After(row.ExpiresAt) {
		if r.aud != nil {
			_ = r.aud.Publish(ctx, "user.refresh", audit.Event{
				TenantID: row.TenantID.String(),
				UserID:   row.UserID.String(),
				Result:   "denied",
				Meta:     map[string]any{"reason": "expired"},
			})
		}
		return nil, domain.ErrRefreshTokenInvalid
	}

	// Mint the new access token. Re-resolving roles each refresh keeps the
	// access token in sync with role grants/revokes since last login.
	roles, err := r.users.RolesForUser(ctx, row.TenantID, row.UserID)
	if err != nil {
		return nil, err
	}
	access, err := r.signer.Sign(libauth.Claims{
		Subject:  row.UserID.String(),
		TenantID: row.TenantID.String(),
		Roles:    roles,
		TTL:      r.accTTL,
	})
	if err != nil {
		return nil, err
	}

	// Mint and persist the new refresh row in the same family with parent
	// pointing at the presented one, then revoke the presented row.
	plaintext, newHash, err := domain.MintRefreshToken()
	if err != nil {
		return nil, err
	}
	newRow := &domain.RefreshToken{
		TenantID:  row.TenantID,
		UserID:    row.UserID,
		TokenHash: newHash,
		ParentID:  &row.ID,
		FamilyID:  row.FamilyID,
		ExpiresAt: time.Now().Add(r.ttl),
	}
	if err := r.tokens.Insert(ctx, newRow); err != nil {
		return nil, err
	}
	if err := r.tokens.MarkRevoked(ctx, row.TenantID, row.ID); err != nil {
		// Best-effort: we already issued the new pair. Log and continue —
		// the new row is the authoritative active token in the family.
		log.Error().Err(err).
			Str("tenant_id", row.TenantID.String()).
			Str("revoke_id", row.ID.String()).
			Msg("failed to revoke presented refresh token after rotation")
	}

	if r.aud != nil {
		_ = r.aud.Publish(ctx, "user.refresh", audit.Event{
			TenantID: row.TenantID.String(),
			UserID:   row.UserID.String(),
			Result:   "success",
			Meta:     map[string]any{"family_id": row.FamilyID.String()},
		})
	}

	return &TokenPair{
		AccessToken:  access,
		RefreshToken: plaintext,
		ExpiresAt:    time.Now().Add(r.accTTL),
	}, nil
}

