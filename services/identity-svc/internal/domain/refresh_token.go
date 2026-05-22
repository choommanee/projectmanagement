package domain

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/google/uuid"
)

// Refresh-token specific sentinel errors. These are exposed at the API layer
// as 401s; the handler does NOT distinguish reuse-vs-unknown-vs-expired in
// the response body — leaking that detail aids attackers profiling the
// rotation state.
var (
	ErrRefreshTokenInvalid   = errors.New("refresh token invalid")
	ErrRefreshTokenExpired   = errors.New("refresh token expired")
	ErrRefreshTokenRevoked   = errors.New("refresh token revoked")
	ErrRefreshTokenReuse     = errors.New("refresh token reuse detected")
	ErrRefreshTokenMalformed = errors.New("refresh token malformed")
)

// RefreshToken is the persistent record of an issued refresh token. The
// presented (plaintext) token is opaque: 32 random bytes hex-encoded for
// transport. token_hash on the row is sha256(decoded_bytes).
type RefreshToken struct {
	ID        uuid.UUID
	TenantID  uuid.UUID
	UserID    uuid.UUID
	TokenHash []byte // 32 bytes, sha256
	ParentID  *uuid.UUID
	FamilyID  uuid.UUID
	IssuedAt  time.Time
	ExpiresAt time.Time
	RevokedAt *time.Time
}

// MintRefreshToken returns a fresh opaque token (64 hex chars) plus its
// sha256 hash. The hash is what gets persisted; the plaintext is returned to
// the caller exactly once.
func MintRefreshToken() (plaintext string, hash []byte, err error) {
	raw := make([]byte, 32)
	if _, err = rand.Read(raw); err != nil {
		return "", nil, err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(raw), sum[:], nil
}

// HashRefreshToken parses a presented hex token and returns sha256 of the
// decoded bytes. It rejects anything that isn't exactly 64 hex chars to
// avoid burning a DB round-trip on garbage.
func HashRefreshToken(presented string) ([]byte, error) {
	if len(presented) != 64 {
		return nil, ErrRefreshTokenMalformed
	}
	raw, err := hex.DecodeString(presented)
	if err != nil {
		return nil, ErrRefreshTokenMalformed
	}
	sum := sha256.Sum256(raw)
	return sum[:], nil
}
