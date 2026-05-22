package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"

	"github.com/google/uuid"
	"golang.org/x/crypto/hkdf"
)

// mfaCrypto is the envelope-encryption helper for TOTP shared secrets.
//
// Key hierarchy:
//
//	MFA_MASTER_KEY (64 hex chars / 32 bytes) — single env-injected secret
//	  ↓ HKDF-SHA256, salt = tenant_id_bytes, info = "mfa_secret_v1"
//	per-tenant data key (32 bytes)
//	  ↓ AES-256-GCM
//	encrypted TOTP secret (stored as nonce || ciphertext in `secret_encrypted`)
//
// A single-tenant ciphertext leak therefore does NOT expose other tenants'
// secrets — an attacker would still need MFA_MASTER_KEY to derive their data
// keys. Rotating MFA_MASTER_KEY requires a re-encrypt migration, deferred.
type mfaCrypto struct {
	master []byte // 32 bytes
}

const mfaHKDFInfo = "mfa_secret_v1"

// newMFACrypto parses MFA_MASTER_KEY (expected 64 hex chars → 32 bytes) and
// returns a ready-to-use helper. An empty / wrong-shaped value is a fatal
// configuration error: we'd rather refuse to start than silently fall back
// to a deterministic key.
func newMFACrypto(masterHex string) (*mfaCrypto, error) {
	if masterHex == "" {
		return nil, errors.New("MFA_MASTER_KEY not set")
	}
	b, err := hex.DecodeString(masterHex)
	if err != nil {
		return nil, errors.New("MFA_MASTER_KEY: expected hex")
	}
	if len(b) != 32 {
		return nil, errors.New("MFA_MASTER_KEY: expected 32 bytes (64 hex chars)")
	}
	return &mfaCrypto{master: b}, nil
}

// deriveKey computes the per-tenant data key. tenant_id bytes (16) act as
// the HKDF salt so two tenants holding the same master never share a
// derived key.
func (m *mfaCrypto) deriveKey(tenantID uuid.UUID) ([]byte, error) {
	tb, _ := tenantID.MarshalBinary()
	h := hkdf.New(sha256.New, m.master, tb, []byte(mfaHKDFInfo))
	out := make([]byte, 32)
	if _, err := io.ReadFull(h, out); err != nil {
		return nil, err
	}
	return out, nil
}

// Encrypt wraps the plaintext secret in AES-256-GCM under the tenant's
// derived key. The returned blob is nonce(12) || ciphertext(N+tag(16)) —
// stored as-is in mfa_enrollment.secret_encrypted.
func (m *mfaCrypto) Encrypt(plaintext []byte, tenantID uuid.UUID) ([]byte, error) {
	key, err := m.deriveKey(tenantID)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	ct := gcm.Seal(nil, nonce, plaintext, nil)
	out := make([]byte, 0, len(nonce)+len(ct))
	out = append(out, nonce...)
	out = append(out, ct...)
	return out, nil
}

// Decrypt undoes Encrypt. Returns an error on auth tag mismatch, which is
// what we want — a tampered ciphertext should NEVER yield a usable secret.
func (m *mfaCrypto) Decrypt(blob []byte, tenantID uuid.UUID) ([]byte, error) {
	key, err := m.deriveKey(tenantID)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(blob) < gcm.NonceSize() {
		return nil, errors.New("mfa ciphertext too short")
	}
	nonce := blob[:gcm.NonceSize()]
	ct := blob[gcm.NonceSize():]
	return gcm.Open(nil, nonce, ct, nil)
}
