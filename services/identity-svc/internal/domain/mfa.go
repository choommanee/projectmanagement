package domain

import (
	"crypto/rand"
	"errors"
	"time"

	"github.com/google/uuid"
)

// MFA sentinel errors. Surfaced at the API layer:
//   * AlreadyEnrolled       → 409 (enroll attempted while a confirmed row exists)
//   * NotEnrolled           → 404 (verify/disable with no row, OR verify with confirmed row)
//   * InvalidCode           → 400 / 401 (totp mismatch or unknown backup code)
//   * RateLimited           → 429
//   * MFARequired           → returned as a special success body from Login
//   * MFATokenInvalid       → 401 on the challenge endpoint
const (
	BackupCodeCount   = 8
	BackupCodeLength  = 8 // alnum chars
	TOTPCodeLength    = 6
)

var (
	ErrMFAAlreadyEnrolled = errors.New("mfa already enrolled")
	ErrMFANotEnrolled     = errors.New("mfa not enrolled")
	ErrMFAInvalidCode     = errors.New("mfa code invalid")
	ErrMFARateLimited     = errors.New("mfa rate limited")
	ErrMFATokenInvalid    = errors.New("mfa token invalid")
)

// MFAEnrollment mirrors the mfa_enrollment row. SecretEncrypted is the raw
// AES-GCM ciphertext (nonce || ciphertext) — callers must decrypt before
// passing the secret to a TOTP library.
type MFAEnrollment struct {
	ID                 uuid.UUID
	TenantID           uuid.UUID
	UserID             uuid.UUID
	SecretEncrypted    []byte
	Algorithm          string
	ConfirmedAt        *time.Time
	BackupCodesHashed  []string
	CreatedAt          time.Time
}

// IsConfirmed is a convenience: ConfirmedAt non-nil means the user finished
// the verify step and login should now gate on MFA.
func (e *MFAEnrollment) IsConfirmed() bool { return e != nil && e.ConfirmedAt != nil }

// backupCodeAlphabet is intentionally an unambiguous alnum subset: no 0/O,
// 1/I/L confusion so codes typed off a screen are reliable.
const backupCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// GenerateBackupCodes returns BackupCodeCount fresh codes of BackupCodeLength
// chars each. Codes are drawn from a confusion-free alnum alphabet so users
// transcribing them from a screen don't trip over 0/O or 1/I.
func GenerateBackupCodes() ([]string, error) {
	out := make([]string, BackupCodeCount)
	buf := make([]byte, BackupCodeLength)
	for i := 0; i < BackupCodeCount; i++ {
		if _, err := rand.Read(buf); err != nil {
			return nil, err
		}
		s := make([]byte, BackupCodeLength)
		for j := 0; j < BackupCodeLength; j++ {
			s[j] = backupCodeAlphabet[int(buf[j])%len(backupCodeAlphabet)]
		}
		out[i] = string(s)
	}
	return out, nil
}
