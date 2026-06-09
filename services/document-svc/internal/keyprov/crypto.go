package keyprov

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
)

// Envelope-encryption scheme (enc_alg='aes256gcm'):
//
//	DEK  = HKDF-SHA256(secret=SIGN_KEY_MASTER_KEY, salt=kid, info=dekInfo, 32)
//	ct   = AES-256-GCM(DEK, nonce, privateKeyBytes)
//
// The per-key DEK means rotating the master key only requires re-wrapping,
// and a leaked ciphertext for one kid never shares key material with another.

const (
	// AlgPlaintext marks legacy rows: private_key is raw base64 key material.
	AlgPlaintext = "plaintext"
	// AlgAES256GCM marks envelope-encrypted rows: private_key is base64 of
	// the AES-256-GCM ciphertext, enc_nonce holds the GCM nonce.
	AlgAES256GCM = "aes256gcm"

	dekInfo = "document-svc/sign-key-dek/v1"
)

// MasterKeyEnv is the environment variable holding the base64 (std) 32-byte
// master key for the db-encrypted provider.
const MasterKeyEnv = "SIGN_KEY_MASTER_KEY"

// MasterKeyFromEnv parses SIGN_KEY_MASTER_KEY. Returns nil when unset.
func MasterKeyFromEnv() (*[32]byte, error) {
	raw := os.Getenv(MasterKeyEnv)
	if raw == "" {
		return nil, nil
	}
	b, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("keyprov: %s is not valid base64: %w", MasterKeyEnv, err)
	}
	if len(b) != 32 {
		return nil, fmt.Errorf("keyprov: %s must decode to 32 bytes, got %d", MasterKeyEnv, len(b))
	}
	var k [32]byte
	copy(k[:], b)
	return &k, nil
}

// deriveDEK derives the per-key data-encryption key for a kid.
func deriveDEK(master *[32]byte, kid string) ([]byte, error) {
	return hkdf.Key(sha256.New, master[:], []byte(kid), dekInfo, 32)
}

// sealKey encrypts private key material for storage. Returns ciphertext + nonce.
func sealKey(master *[32]byte, kid string, plaintext []byte) (ct, nonce []byte, err error) {
	dek, err := deriveDEK(master, kid)
	if err != nil {
		return nil, nil, err
	}
	block, err := aes.NewCipher(dek)
	if err != nil {
		return nil, nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}
	nonce = make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, err
	}
	return gcm.Seal(nil, nonce, plaintext, []byte(kid)), nonce, nil
}

// openKey decrypts stored private key material.
func openKey(master *[32]byte, kid string, ct, nonce []byte) ([]byte, error) {
	if master == nil {
		return nil, errors.New("keyprov: encrypted key present but no master key configured (" + MasterKeyEnv + ")")
	}
	dek, err := deriveDEK(master, kid)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(dek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	pt, err := gcm.Open(nil, nonce, ct, []byte(kid))
	if err != nil {
		return nil, fmt.Errorf("keyprov: unwrap key %q failed (wrong master key?): %w", kid, err)
	}
	return pt, nil
}
