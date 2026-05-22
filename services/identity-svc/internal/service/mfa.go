package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"

	"github.com/pmplatform/libs/go/audit"

	"github.com/pmplatform/services/identity-svc/internal/domain"
	"github.com/pmplatform/services/identity-svc/internal/store"
)

// MFAIssuer is the TOTP issuer label shown to authenticator apps. The
// account string is "<tenant_slug>:<email>" so a single user across multiple
// tenants doesn't collide in the user's authenticator app.
const MFAIssuer = "pmplatform"

// mfaFailureWindow / mfaFailureMax bound the in-memory rate limiter.
// LIMITATION: the limiter is process-local — multi-replica deployments will
// effectively allow N*max attempts per window. Phase 1 acceptable; revisit
// once we have Redis or a shared cache for auth state.
const (
	mfaFailureWindow = 5 * time.Minute
	mfaFailureMax    = 5
)

// MFA orchestrates the four entry points (enroll / verify / challenge / disable)
// for TOTP MFA. The crypto helper holds the master key; the store handles
// persistence; the signer is used to mint the short-lived step-up token
// returned from Login when MFA is required.
type MFA struct {
	enrollments *store.MFAEnrollments
	users       *store.Users
	crypto      *mfaCrypto
	signer      TokenSigner
	aud         AuditPublisher
	limiter     *mfaRateLimiter
}

// NewMFA constructs the service. The masterHex is the MFA_MASTER_KEY env
// (validated by newMFACrypto). signer is the same DynamicSigner used by
// Auth so the step-up token is signed by the active key.
func NewMFA(
	enrollments *store.MFAEnrollments,
	users *store.Users,
	masterHex string,
	signer TokenSigner,
	aud AuditPublisher,
) (*MFA, error) {
	c, err := newMFACrypto(masterHex)
	if err != nil {
		return nil, err
	}
	return &MFA{
		enrollments: enrollments,
		users:       users,
		crypto:      c,
		signer:      signer,
		aud:         aud,
		limiter:     newMFARateLimiter(),
	}, nil
}

// MFAEnrollResponse is what Enroll hands back to the client.
// BackupCodes are returned ONCE in plaintext — the server only ever stores
// bcrypt hashes after this call.
type MFAEnrollResponse struct {
	OTPAuthURL  string   `json:"otpauth_url"`
	QRPNGBase64 string   `json:"qr_png_base64,omitempty"`
	BackupCodes []string `json:"backup_codes"`
}

// Enroll creates (or replaces an unconfirmed) enrollment row for the user.
// Returns 409 (ErrMFAAlreadyEnrolled) if a CONFIRMED row already exists —
// to re-enroll, the user must first /disable.
//
// QR generation: skipped in Phase 1 to avoid pulling in a PNG dependency.
// Authenticator apps universally accept the otpauth:// URL directly; the UI
// can call a client-side QR library if it wants a visual.
func (m *MFA) Enroll(ctx context.Context, tenantID, userID uuid.UUID, email string) (*MFAEnrollResponse, error) {
	// Block re-enroll over a confirmed row. An unconfirmed row is replaced
	// in-place so users who bailed mid-enrollment can restart cleanly.
	if existing, err := m.enrollments.FindByUser(ctx, tenantID, userID); err == nil {
		if existing.IsConfirmed() {
			return nil, domain.ErrMFAAlreadyEnrolled
		}
	} else if !errors.Is(err, domain.ErrMFANotEnrolled) {
		return nil, err
	}

	// Look up tenant slug for the otpauth account label. We tolerate an
	// empty slug (very early test setups) — the URL is still valid, just
	// less friendly in the authenticator app.
	slug, err := m.tenantSlug(ctx, tenantID)
	if err != nil {
		slug = ""
	}
	account := email
	if slug != "" {
		account = slug + ":" + email
	}

	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      MFAIssuer,
		AccountName: account,
	})
	if err != nil {
		return nil, err
	}

	ct, err := m.crypto.Encrypt([]byte(key.Secret()), tenantID)
	if err != nil {
		return nil, err
	}

	codes, err := domain.GenerateBackupCodes()
	if err != nil {
		return nil, err
	}
	hashed := make([]string, 0, len(codes))
	for _, c := range codes {
		h, err := bcrypt.GenerateFromPassword([]byte(c), bcrypt.DefaultCost)
		if err != nil {
			return nil, err
		}
		hashed = append(hashed, string(h))
	}

	row := &domain.MFAEnrollment{
		TenantID:          tenantID,
		UserID:            userID,
		SecretEncrypted:   ct,
		Algorithm:         "TOTP",
		ConfirmedAt:       nil,
		BackupCodesHashed: hashed,
	}
	if err := m.enrollments.Upsert(ctx, row); err != nil {
		return nil, err
	}

	if m.aud != nil {
		_ = m.aud.Publish(ctx, "user.mfa_enroll_started", audit.Event{
			TenantID: tenantID.String(),
			UserID:   userID.String(),
			Result:   "success",
		})
	}

	return &MFAEnrollResponse{
		OTPAuthURL:  key.URL(),
		BackupCodes: codes,
	}, nil
}

// Verify validates the presented TOTP code against the (still-unconfirmed)
// enrollment row. On success stamps confirmed_at; thereafter login gates
// on MFA. Failed attempts feed the in-memory rate limiter.
func (m *MFA) Verify(ctx context.Context, tenantID, userID uuid.UUID, code string) error {
	if !m.limiter.allow(userID) {
		return domain.ErrMFARateLimited
	}
	row, err := m.enrollments.FindByUser(ctx, tenantID, userID)
	if err != nil {
		return err
	}
	if row.IsConfirmed() {
		// Already confirmed — no point re-verifying via this endpoint.
		return domain.ErrMFAAlreadyEnrolled
	}
	secret, err := m.crypto.Decrypt(row.SecretEncrypted, tenantID)
	if err != nil {
		return err
	}
	if !totp.Validate(code, string(secret)) {
		m.limiter.record(userID)
		if m.aud != nil {
			_ = m.aud.Publish(ctx, "user.mfa_verify", audit.Event{
				TenantID: tenantID.String(),
				UserID:   userID.String(),
				Result:   "denied",
			})
		}
		return domain.ErrMFAInvalidCode
	}
	if err := m.enrollments.MarkConfirmed(ctx, tenantID, row.ID); err != nil {
		return err
	}
	if m.aud != nil {
		_ = m.aud.Publish(ctx, "user.mfa_verify", audit.Event{
			TenantID: tenantID.String(),
			UserID:   userID.String(),
			Result:   "success",
		})
	}
	return nil
}

// Challenge validates a code (or backup code) against a confirmed enrollment.
// Returns nil iff the user has passed the second factor. Backup codes are
// consumed (removed from the array) on success.
//
// The 6-char vs 8-char branch is the heuristic that keeps the API tidy: if
// the user types a 6-digit numeric, we route to TOTP; an 8-char alnum routes
// to backup codes. Anything else fails fast.
func (m *MFA) Challenge(ctx context.Context, tenantID, userID uuid.UUID, code string) error {
	if !m.limiter.allow(userID) {
		return domain.ErrMFARateLimited
	}
	row, err := m.enrollments.FindByUserUnscoped(ctx, userID)
	if err != nil {
		return err
	}
	if !row.IsConfirmed() {
		return domain.ErrMFANotEnrolled
	}
	if row.TenantID != tenantID {
		// Defensive: the mfa_token claim said tenant X but the row says Y.
		// This would be a sign of token tampering or a stale enrollment.
		return domain.ErrMFAInvalidCode
	}

	switch len(code) {
	case domain.TOTPCodeLength:
		secret, err := m.crypto.Decrypt(row.SecretEncrypted, tenantID)
		if err != nil {
			return err
		}
		if !totp.Validate(code, string(secret)) {
			m.limiter.record(userID)
			return domain.ErrMFAInvalidCode
		}
	case domain.BackupCodeLength:
		// Linear scan + bcrypt compare. With BackupCodeCount=8 this is fast
		// enough not to need a hash-table; we keep order stable so the
		// remaining indices line up with what we initially returned.
		matched := -1
		for i, hashed := range row.BackupCodesHashed {
			if bcrypt.CompareHashAndPassword([]byte(hashed), []byte(code)) == nil {
				matched = i
				break
			}
		}
		if matched < 0 {
			m.limiter.record(userID)
			return domain.ErrMFAInvalidCode
		}
		// Consume: drop the used entry.
		trimmed := make([]string, 0, len(row.BackupCodesHashed)-1)
		trimmed = append(trimmed, row.BackupCodesHashed[:matched]...)
		trimmed = append(trimmed, row.BackupCodesHashed[matched+1:]...)
		if err := m.enrollments.UpdateBackupCodes(ctx, tenantID, row.ID, trimmed); err != nil {
			return err
		}
	default:
		m.limiter.record(userID)
		return domain.ErrMFAInvalidCode
	}

	if m.aud != nil {
		_ = m.aud.Publish(ctx, "user.mfa_challenge", audit.Event{
			TenantID: tenantID.String(),
			UserID:   userID.String(),
			Result:   "success",
		})
	}
	return nil
}

// Disable deletes the enrollment row after re-verifying the current
// password. Caller (handler) is responsible for fetching the user object
// and passing the bcrypt hash here.
func (m *MFA) Disable(ctx context.Context, tenantID, userID uuid.UUID, passwordHash, currentPassword string) error {
	if err := domain.CheckPassword(passwordHash, currentPassword); err != nil {
		return err
	}
	if err := m.enrollments.Delete(ctx, tenantID, userID); err != nil {
		return err
	}
	if m.aud != nil {
		_ = m.aud.Publish(ctx, "user.mfa_disabled", audit.Event{
			TenantID: tenantID.String(),
			UserID:   userID.String(),
			Result:   "success",
		})
	}
	return nil
}

// tenantSlug looks up the human-readable slug for a tenant. Best-effort:
// callers tolerate a miss (the otpauth label just drops the slug prefix).
func (m *MFA) tenantSlug(ctx context.Context, tenantID uuid.UUID) (string, error) {
	// We piggyback on the existing users store's pool by issuing a direct
	// query. A dedicated tenant store would be cleaner; deferred to keep
	// this task self-contained.
	var slug string
	err := m.users.QuerySlug(ctx, tenantID, &slug)
	return slug, err
}

// MFARateLimiter bucket: in-memory sliding window per user. Single-process
// only — multi-replica deployments share nothing here. See top of file.
type mfaRateLimiter struct {
	mu      sync.Mutex
	buckets map[uuid.UUID]*mfaBucket
}

type mfaBucket struct {
	failures []time.Time
}

func newMFARateLimiter() *mfaRateLimiter {
	return &mfaRateLimiter{buckets: make(map[uuid.UUID]*mfaBucket)}
}

// allow returns true iff the user has <mfaFailureMax recorded failures
// within mfaFailureWindow. Does NOT record an attempt — call record() on
// failure separately so a successful login doesn't burn a slot.
func (r *mfaRateLimiter) allow(uid uuid.UUID) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	b := r.buckets[uid]
	if b == nil {
		return true
	}
	now := time.Now()
	live := b.failures[:0]
	for _, t := range b.failures {
		if now.Sub(t) < mfaFailureWindow {
			live = append(live, t)
		}
	}
	b.failures = live
	return len(b.failures) < mfaFailureMax
}

// record stamps a failure timestamp.
func (r *mfaRateLimiter) record(uid uuid.UUID) {
	r.mu.Lock()
	defer r.mu.Unlock()
	b := r.buckets[uid]
	if b == nil {
		b = &mfaBucket{}
		r.buckets[uid] = b
	}
	b.failures = append(b.failures, time.Now())
}

// ResetForTest exposes a way for tests to clear the limiter between cases.
// Production code should never call this.
func (m *MFA) ResetForTest(uid uuid.UUID) {
	m.limiter.mu.Lock()
	defer m.limiter.mu.Unlock()
	delete(m.limiter.buckets, uid)
}

// ensure fmt import is referenced — kept for future error wrapping.
var _ = fmt.Errorf
