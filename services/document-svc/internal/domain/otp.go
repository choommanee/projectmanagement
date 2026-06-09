package domain

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/google/uuid"
)

// --- Email-OTP step-up for signers (auth_method=email_otp) ------------------
//
// A signer whose row carries auth_method=email_otp must prove email
// possession before signing: they request a challenge (a 6-digit code sent to
// their email via the notification pipeline), then include the code in the
// sign request. The code is never stored — only SHA-256(code || salt).

// OTPExpiry is how long a challenge stays valid after issuance.
const OTPExpiry = 10 * time.Minute

// OTPMaxAttempts is the number of wrong codes before a challenge is dead.
const OTPMaxAttempts = 5

// OTPRateLimitMax / OTPRateLimitWindow: max challenge requests per signer
// within the window (anti-abuse on the email channel).
const (
	OTPRateLimitMax    = 3
	OTPRateLimitWindow = 5 * time.Minute
)

// SignOTPChallenge is one issued email-OTP challenge for a signer row.
type SignOTPChallenge struct {
	ID          uuid.UUID  `json:"id"`
	TenantID    uuid.UUID  `json:"tenant_id"`
	EnvelopeID  uuid.UUID  `json:"envelope_id"`
	SignerRowID uuid.UUID  `json:"signer_id"` // document_signature row id
	CodeHash    string     `json:"-"`
	Salt        string     `json:"-"`
	ExpiresAt   time.Time  `json:"expires_at"`
	Attempts    int        `json:"attempts"`
	ConsumedAt  *time.Time `json:"consumed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

// AuthEvidence is the jsonb proof persisted on the signature row recording
// HOW the signer's identity was verified at signing time.
type AuthEvidence struct {
	Method      string    `json:"method"`
	ChallengeID uuid.UUID `json:"challenge_id"`
	VerifiedAt  time.Time `json:"verified_at"`
}

// OTP ceremony audit-event kinds (ride the event hash chain like any other).
const (
	EvOTPRequested SignEventType = "otp_requested"
	EvOTPVerified  SignEventType = "otp_verified"
)

// HashOTPCode returns hex(SHA-256(code || salt)).
func HashOTPCode(code, salt string) string {
	sum := sha256.Sum256([]byte(code + salt))
	return hex.EncodeToString(sum[:])
}

// OTP error taxonomy. Handlers map these to:
//
//	ErrOTPRequired    → 428 Precondition Required ("otp_required")
//	ErrOTPInvalid     → 403 ("otp_invalid")
//	ErrOTPExpired     → 403 ("otp_expired")
//	ErrOTPRateLimited → 429 ("otp_rate_limited")
var (
	ErrOTPRequired    = errors.New("otp_required")
	ErrOTPInvalid     = errors.New("otp_invalid")
	ErrOTPExpired     = errors.New("otp_expired")
	ErrOTPRateLimited = errors.New("otp_rate_limited")
)
