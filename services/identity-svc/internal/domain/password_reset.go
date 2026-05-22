package domain

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/google/uuid"
)

// Password-reset sentinel errors. The Reset handler collapses unknown /
// expired / consumed into a single ErrPasswordResetInvalid so attackers
// cannot fingerprint token state through error responses.
var (
	ErrPasswordResetInvalid   = errors.New("password reset token invalid")
	ErrPasswordResetExpired   = errors.New("password reset token expired")
	ErrPasswordResetConsumed  = errors.New("password reset token already used")
	ErrPasswordResetMalformed = errors.New("password reset token malformed")
)

// PasswordResetToken is the persistent record of an issued reset link.
// The plaintext token is 32 random bytes hex-encoded (64 hex chars).
// token_hash on the row is sha256(decoded_bytes).
type PasswordResetToken struct {
	ID         uuid.UUID
	TenantID   uuid.UUID
	UserID     uuid.UUID
	TokenHash  []byte // 32 bytes, sha256
	ExpiresAt  time.Time
	ConsumedAt *time.Time
	CreatedAt  time.Time
}

// MintPasswordResetToken returns a fresh opaque token (64 hex chars) plus
// its sha256 hash. The hash is what gets persisted; the plaintext is
// returned to the caller exactly once for delivery via mailer.
func MintPasswordResetToken() (plaintext string, hash []byte, err error) {
	raw := make([]byte, 32)
	if _, err = rand.Read(raw); err != nil {
		return "", nil, err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(raw), sum[:], nil
}

// HashPasswordResetToken parses a presented hex token and returns sha256
// of the decoded bytes. It rejects anything that isn't exactly 64 hex
// chars to avoid burning a DB round-trip on garbage.
func HashPasswordResetToken(presented string) ([]byte, error) {
	if len(presented) != 64 {
		return nil, ErrPasswordResetMalformed
	}
	raw, err := hex.DecodeString(presented)
	if err != nil {
		return nil, ErrPasswordResetMalformed
	}
	sum := sha256.Sum256(raw)
	return sum[:], nil
}
