// Package keyprov hardens custody of the platform record-signing key
// (document_sign_key) behind a Provider interface with two implementations:
//
//   - "db"           — current behavior: Ed25519 private key stored base64
//     plaintext (enc_alg='plaintext'). Default for backward compatibility.
//   - "db-encrypted" — private keys AES-256-GCM envelope-encrypted at rest
//     with a per-key DEK derived from SIGN_KEY_MASTER_KEY (see crypto.go).
//     A pre-existing plaintext active key is superseded (active=false) by a
//     freshly generated encrypted key; the old key row is retained so
//     signatures it produced keep verifying via the plaintext public_key.
//
// Selected via SIGN_KEY_PROVIDER (default "db").
//
// KMS stub (future work): a third implementation "kms" would satisfy the same
// Provider interface by delegating Sign to AWS KMS (kms:Sign with an
// Ed25519/ECC key) or GCP Cloud KMS (asymmetric-signing CryptoKeyVersion),
// caching only the public key + kid locally — private key material never
// leaves the HSM. Wiring point: FromEnv() switch below.
package keyprov

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"sync"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ProviderEnv selects the key provider implementation.
const ProviderEnv = "SIGN_KEY_PROVIDER"

// Signer is an active signing key handle.
type Signer interface {
	KID() string
	Public() ed25519.PublicKey
	Sign(data []byte) []byte
}

// Provider abstracts custody of the platform Ed25519 record-signing key.
type Provider interface {
	// Active returns the active signing key, loading or creating it lazily.
	Active(ctx context.Context) (Signer, string, error)
	// Sign signs data with the active key.
	Sign(ctx context.Context, data []byte) (sig []byte, kid string, err error)
}

// FromEnv constructs the provider selected by SIGN_KEY_PROVIDER.
func FromEnv(pool *pgxpool.Pool) (Provider, error) {
	mode := os.Getenv(ProviderEnv)
	if mode == "" {
		mode = "db"
	}
	switch mode {
	case "db":
		return NewDB(pool), nil
	case "db-encrypted":
		master, err := MasterKeyFromEnv()
		if err != nil {
			return nil, err
		}
		if master == nil {
			return nil, fmt.Errorf("keyprov: %s=db-encrypted requires %s (base64 32 bytes)", ProviderEnv, MasterKeyEnv)
		}
		return NewDBEncrypted(pool, master), nil
	// case "kms": see package comment — AWS/GCP KMS-backed Provider stub.
	default:
		return nil, fmt.Errorf("keyprov: unknown %s=%q (want db|db-encrypted)", ProviderEnv, mode)
	}
}

// ed25519Signer is the in-memory key handle shared by both DB providers.
type ed25519Signer struct {
	kid  string
	priv ed25519.PrivateKey
	pub  ed25519.PublicKey
}

func (s *ed25519Signer) KID() string               { return s.kid }
func (s *ed25519Signer) Public() ed25519.PublicKey { return s.pub }
func (s *ed25519Signer) Sign(data []byte) []byte   { return ed25519.Sign(s.priv, data) }

// --- db (plaintext, legacy-compatible) ---------------------------------------

// DB stores Ed25519 keys base64-plaintext in document_sign_key — the original
// behavior of store/signkey.go, refactored behind the Provider interface.
type DB struct {
	pool *pgxpool.Pool
	mu   sync.Mutex
	key  *ed25519Signer
}

// NewDB returns the plaintext db provider.
func NewDB(pool *pgxpool.Pool) *DB { return &DB{pool: pool} }

// Active implements Provider.
func (p *DB) Active(ctx context.Context) (Signer, string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.key != nil {
		return p.key, p.key.kid, nil
	}
	k, err := loadActive(ctx, p.pool, nil)
	if errors.Is(err, pgx.ErrNoRows) {
		k, err = createPlaintext(ctx, p.pool)
	}
	if err != nil {
		return nil, "", err
	}
	p.key = k
	return k, k.kid, nil
}

// Sign implements Provider.
func (p *DB) Sign(ctx context.Context, data []byte) ([]byte, string, error) {
	k, kid, err := p.Active(ctx)
	if err != nil {
		return nil, "", err
	}
	return k.Sign(data), kid, nil
}

// --- db-encrypted -------------------------------------------------------------

// DBEncrypted stores Ed25519 private keys AES-256-GCM envelope-encrypted.
type DBEncrypted struct {
	pool   *pgxpool.Pool
	master *[32]byte
	mu     sync.Mutex
	key    *ed25519Signer
}

// NewDBEncrypted returns the encrypted-at-rest provider.
func NewDBEncrypted(pool *pgxpool.Pool, master *[32]byte) *DBEncrypted {
	return &DBEncrypted{pool: pool, master: master}
}

// Active implements Provider. Mixed mode: when the current active key is
// plaintext, it is superseded by a freshly generated encrypted key in one
// transaction; the plaintext row stays for verification of old signatures.
func (p *DBEncrypted) Active(ctx context.Context) (Signer, string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.key != nil {
		return p.key, p.key.kid, nil
	}
	for range 2 { // retry once after migrate/create races
		k, alg, err := loadActiveWithAlg(ctx, p.pool, p.master)
		switch {
		case err == nil && alg == AlgAES256GCM:
			p.key = k
			return k, k.kid, nil
		case err == nil && alg == AlgPlaintext:
			// supersede plaintext with an encrypted key
			if _, err := p.createEncrypted(ctx, true); err != nil {
				return nil, "", err
			}
		case errors.Is(err, pgx.ErrNoRows):
			if _, err := p.createEncrypted(ctx, false); err != nil {
				return nil, "", err
			}
		case err != nil:
			return nil, "", err
		}
	}
	k, alg, err := loadActiveWithAlg(ctx, p.pool, p.master)
	if err != nil {
		return nil, "", fmt.Errorf("keyprov: encrypted key bootstrap failed: %w", err)
	}
	if alg != AlgAES256GCM {
		return nil, "", errors.New("keyprov: encrypted key bootstrap left a non-encrypted active key")
	}
	p.key = k
	return k, k.kid, nil
}

// Sign implements Provider.
func (p *DBEncrypted) Sign(ctx context.Context, data []byte) ([]byte, string, error) {
	k, kid, err := p.Active(ctx)
	if err != nil {
		return nil, "", err
	}
	return k.Sign(data), kid, nil
}

// createEncrypted generates a new Ed25519 key, wraps the private half, and
// atomically (a) deactivates a plaintext active key when supersede is set and
// (b) inserts the new active row — guarded so racing replicas converge.
func (p *DBEncrypted) createEncrypted(ctx context.Context, supersede bool) (string, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", err
	}
	kid := "doc-sign-ed25519-" + uuid.NewString()[:8]
	ct, nonce, err := sealKey(p.master, kid, priv)
	if err != nil {
		return "", err
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	if supersede {
		if _, err := tx.Exec(ctx,
			`UPDATE document_sign_key SET active=false WHERE active AND enc_alg=$1`, AlgPlaintext); err != nil {
			return "", err
		}
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO document_sign_key (kid, public_key, private_key, active, enc_alg, enc_nonce)
		 SELECT $1, $2, $3, true, $4, $5
		 WHERE NOT EXISTS (SELECT 1 FROM document_sign_key WHERE active)`,
		kid, base64.StdEncoding.EncodeToString(pub), base64.StdEncoding.EncodeToString(ct),
		AlgAES256GCM, nonce); err != nil {
		return "", err
	}
	return kid, tx.Commit(ctx)
}

// --- shared row loading -------------------------------------------------------

func loadActive(ctx context.Context, pool *pgxpool.Pool, master *[32]byte) (*ed25519Signer, error) {
	k, _, err := loadActiveWithAlg(ctx, pool, master)
	return k, err
}

func loadActiveWithAlg(ctx context.Context, pool *pgxpool.Pool, master *[32]byte) (*ed25519Signer, string, error) {
	var kid, pubB64, privB64, alg string
	var nonce []byte
	err := pool.QueryRow(ctx,
		`SELECT kid, public_key, private_key, enc_alg, enc_nonce FROM document_sign_key
		 WHERE active ORDER BY created_at ASC LIMIT 1`).Scan(&kid, &pubB64, &privB64, &alg, &nonce)
	if err != nil {
		return nil, "", err
	}
	pub, err := base64.StdEncoding.DecodeString(pubB64)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return nil, "", fmt.Errorf("keyprov: malformed public key for kid %q", kid)
	}
	raw, err := base64.StdEncoding.DecodeString(privB64)
	if err != nil {
		return nil, "", fmt.Errorf("keyprov: malformed private key for kid %q", kid)
	}
	switch alg {
	case AlgPlaintext:
		// plaintext keys are returned as-is; db-encrypted callers supersede them
	case AlgAES256GCM:
		raw, err = openKey(master, kid, raw, nonce)
		if err != nil {
			return nil, "", err
		}
	default:
		return nil, "", fmt.Errorf("keyprov: unknown enc_alg %q for kid %q", alg, kid)
	}
	if len(raw) != ed25519.PrivateKeySize {
		return nil, "", fmt.Errorf("keyprov: bad private key length for kid %q", kid)
	}
	return &ed25519Signer{kid: kid, priv: ed25519.PrivateKey(raw), pub: ed25519.PublicKey(pub)}, alg, nil
}

func createPlaintext(ctx context.Context, pool *pgxpool.Pool) (*ed25519Signer, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	kid := "doc-sign-ed25519-" + uuid.NewString()[:8]
	if _, err := pool.Exec(ctx,
		`INSERT INTO document_sign_key (kid, public_key, private_key, active, enc_alg)
		 SELECT $1, $2, $3, true, $4
		 WHERE NOT EXISTS (SELECT 1 FROM document_sign_key WHERE active)`,
		kid, base64.StdEncoding.EncodeToString(pub), base64.StdEncoding.EncodeToString(priv), AlgPlaintext); err != nil {
		return nil, err
	}
	k, err := loadActive(ctx, pool, nil)
	if err != nil {
		return nil, fmt.Errorf("keyprov: plaintext key bootstrap failed: %w", err)
	}
	return k, nil
}
