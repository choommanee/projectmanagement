package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/pmplatform/libs/go/audit"
	notiflib "github.com/pmplatform/libs/go/notification"

	"github.com/pmplatform/services/identity-svc/internal/domain"
	"github.com/pmplatform/services/identity-svc/internal/store"
)

// PasswordReset orchestrates the two-step reset flow:
//
//  1. RequestReset — anti-enumeration. Always returns nil to the caller.
//     If the (tenant, email) resolves to an active user we mint a token,
//     persist sha256(token), and ship the plaintext via Mailer. Unknown
//     tenants / emails / inactive users silently no-op.
//
//  2. ConsumeReset — looks up the row by sha256(token), validates not
//     expired & not already consumed, rewrites password_hash, marks the
//     token consumed, and revokes ALL live refresh tokens for the user
//     so existing sessions die alongside the credential change.
//
// The reset link base URL is provided at construction so the mailer body
// can render a full URL without the service knowing about web routing.
type PasswordReset struct {
	users   *store.Users
	tokens  *store.RefreshTokens
	resets  *store.PasswordResets
	mailer  Mailer
	aud     AuditPublisher
	notif   notiflib.Publisher
	ttl     time.Duration
	linkURL string // e.g. https://app.example.com/reset?token=
}

// NewPasswordReset wires the flow. ttl defaults to 1h when zero.
// linkURL is appended-to with the plaintext token to build the reset
// link sent by the mailer; an empty value falls back to a relative path.
func NewPasswordReset(
	u *store.Users,
	t *store.RefreshTokens,
	r *store.PasswordResets,
	m Mailer,
	aud AuditPublisher,
	ttl time.Duration,
	linkURL string,
	notif notiflib.Publisher,
) *PasswordReset {
	if ttl <= 0 {
		ttl = time.Hour
	}
	if linkURL == "" {
		linkURL = "/reset-password?token="
	}
	return &PasswordReset{
		users:   u,
		tokens:  t,
		resets:  r,
		mailer:  m,
		aud:     aud,
		notif:   notif,
		ttl:     ttl,
		linkURL: linkURL,
	}
}

// RequestReset implements anti-enumeration semantics: the caller always
// gets nil back. Internally, we resolve tenant_slug → tenant_id, then
// email → user, and only on the happy path do we persist a token and
// dispatch the mailer. Any miss returns nil silently.
func (p *PasswordReset) RequestReset(ctx context.Context, tenantSlug, email string) error {
	tid, err := p.users.FindTenantIDBySlug(ctx, tenantSlug)
	if err != nil {
		if !errors.Is(err, domain.ErrNotFound) {
			log.Warn().Err(err).Str("slug", tenantSlug).Msg("password-reset: tenant lookup failed")
		}
		return nil
	}
	u, err := p.users.FindByEmail(ctx, tid, email)
	if err != nil {
		if !errors.Is(err, domain.ErrNotFound) {
			log.Warn().Err(err).Msg("password-reset: user lookup failed")
		}
		return nil
	}
	if u.Status != domain.StatusActive {
		// Suspended / invited accounts intentionally no-op.
		return nil
	}

	plaintext, hash, err := domain.MintPasswordResetToken()
	if err != nil {
		log.Error().Err(err).Msg("password-reset: mint failed")
		return nil
	}
	row := &domain.PasswordResetToken{
		TenantID:  u.TenantID,
		UserID:    u.ID,
		TokenHash: hash,
		ExpiresAt: time.Now().Add(p.ttl),
	}
	if err := p.resets.Insert(ctx, row); err != nil {
		log.Error().Err(err).Msg("password-reset: persist failed")
		return nil
	}

	if p.mailer != nil {
		body := fmt.Sprintf(
			"A password reset was requested for your account. "+
				"Use the following link within %s to set a new password:\n\n%s%s\n\n"+
				"If you did not request this, you can ignore this message.",
			p.ttl, p.linkURL, plaintext)
		if err := p.mailer.Send(ctx, u.Email, "Password reset", body); err != nil {
			log.Warn().Err(err).Msg("password-reset: mailer send failed")
		}
	}

	if p.aud != nil {
		_ = p.aud.Publish(ctx, "user.password_reset_requested", audit.Event{
			TenantID: u.TenantID.String(),
			UserID:   u.ID.String(),
			Result:   "success",
		})
	}
	return nil
}

// ConsumeReset validates the presented token, rewrites the password,
// marks the token consumed, and revokes every live refresh token for
// the user. Failure modes (unknown / expired / consumed) collapse to
// domain.ErrPasswordResetInvalid so the HTTP layer responds with a
// single 400 — same anti-enumeration logic as the request path.
func (p *PasswordReset) ConsumeReset(ctx context.Context, presented, newPassword string) error {
	hash, err := domain.HashPasswordResetToken(presented)
	if err != nil {
		return domain.ErrPasswordResetInvalid
	}
	row, err := p.resets.FindByHash(ctx, hash)
	if err != nil {
		return domain.ErrPasswordResetInvalid
	}
	if row.ConsumedAt != nil {
		return domain.ErrPasswordResetInvalid
	}
	if time.Now().After(row.ExpiresAt) {
		return domain.ErrPasswordResetInvalid
	}

	// domain.HashPassword enforces minimum length + bcrypt cost. It
	// returns ErrPasswordWeak when too short — surface as-is so the
	// API layer renders a 400 with a useful message.
	pwHash, err := domain.HashPassword(newPassword)
	if err != nil {
		return err
	}

	if err := p.users.UpdatePassword(ctx, row.TenantID, row.UserID, pwHash); err != nil {
		return err
	}
	if err := p.resets.MarkConsumed(ctx, row.TenantID, row.ID); err != nil {
		// Password is already rotated; log but don't fail the request.
		log.Error().Err(err).
			Str("tenant_id", row.TenantID.String()).
			Str("reset_id", row.ID.String()).
			Msg("password-reset: mark consumed failed")
	}

	if p.tokens != nil {
		n, err := p.tokens.RevokeAllForUser(ctx, row.TenantID, row.UserID)
		if err != nil {
			log.Error().Err(err).
				Str("tenant_id", row.TenantID.String()).
				Str("user_id", row.UserID.String()).
				Msg("password-reset: revoke refresh tokens failed")
		} else {
			log.Info().
				Str("tenant_id", row.TenantID.String()).
				Str("user_id", row.UserID.String()).
				Int64("rows_revoked", n).
				Msg("password-reset: refresh tokens revoked")
		}
	}

	if p.aud != nil {
		_ = p.aud.Publish(ctx, "user.password_reset_consumed", audit.Event{
			TenantID: row.TenantID.String(),
			UserID:   row.UserID.String(),
			Result:   "success",
		})
	}
	if p.notif != nil {
		_ = p.notif.Publish(ctx, notiflib.Event{
			TenantID: row.TenantID.String(),
			UserID:   row.UserID.String(),
			Kind:     "user.password_reset",
			Title:    "Password reset successful",
		})
	}
	return nil
}
