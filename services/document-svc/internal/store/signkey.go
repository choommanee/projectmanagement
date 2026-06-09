package store

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// signKey is the in-memory view of the active platform record-signing key.
// Pattern follows services/identity-svc/internal/jwt: keys live in Postgres,
// the active one is cached for signing, and rotation is an insert + flag flip
// (rotation endpoint is future work; the storage model already supports it).
type signKey struct {
	kid  string
	priv ed25519.PrivateKey
	pub  ed25519.PublicKey
}

// activeSignKey returns the active Ed25519 record-signing key, generating and
// persisting one lazily on first use. Concurrent first-callers are serialized
// by keyMu; the INSERT is guarded by a WHERE NOT EXISTS so racing replicas
// converge on the oldest active row.
func (s *Signatures) activeSignKey(ctx context.Context) (*signKey, error) {
	s.keyMu.Lock()
	defer s.keyMu.Unlock()
	if s.key != nil {
		return s.key, nil
	}

	load := func() (*signKey, error) {
		var kid, pubB64, privB64 string
		err := s.p.QueryRow(ctx,
			`SELECT kid, public_key, private_key FROM document_sign_key
			 WHERE active ORDER BY created_at ASC LIMIT 1`).Scan(&kid, &pubB64, &privB64)
		if err != nil {
			return nil, err
		}
		return decodeSignKey(kid, pubB64, privB64)
	}

	k, err := load()
	if err == nil {
		s.key = k
		return k, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	// No key yet — generate one. WHERE NOT EXISTS keeps this race-safe across
	// replicas: at most one insert wins; everyone re-reads the active row.
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	kid := "doc-sign-ed25519-" + uuid.NewString()[:8]
	if _, err := s.p.Exec(ctx,
		`INSERT INTO document_sign_key (kid, public_key, private_key, active)
		 SELECT $1, $2, $3, true
		 WHERE NOT EXISTS (SELECT 1 FROM document_sign_key WHERE active)`,
		kid, base64.StdEncoding.EncodeToString(pub), base64.StdEncoding.EncodeToString(priv)); err != nil {
		return nil, err
	}
	k, err = load()
	if err != nil {
		return nil, fmt.Errorf("record-signing key bootstrap failed: %w", err)
	}
	s.key = k
	return k, nil
}

// PublicKeyFor returns the Ed25519 public key for a kid (verify path).
// Results are cached; keys are never deleted, only superseded.
func (s *Signatures) PublicKeyFor(ctx context.Context, kid string) (ed25519.PublicKey, error) {
	if v, ok := s.pubCache.Load(kid); ok {
		return v.(ed25519.PublicKey), nil
	}
	var pubB64 string
	if err := s.p.QueryRow(ctx,
		`SELECT public_key FROM document_sign_key WHERE kid=$1`, kid).Scan(&pubB64); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("unknown record-signing kid %q", kid)
		}
		return nil, err
	}
	raw, err := base64.StdEncoding.DecodeString(pubB64)
	if err != nil || len(raw) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("malformed public key for kid %q", kid)
	}
	pub := ed25519.PublicKey(raw)
	s.pubCache.Store(kid, pub)
	return pub, nil
}

func decodeSignKey(kid, pubB64, privB64 string) (*signKey, error) {
	pub, err := base64.StdEncoding.DecodeString(pubB64)
	if err != nil || len(pub) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("malformed public key for kid %q", kid)
	}
	priv, err := base64.StdEncoding.DecodeString(privB64)
	if err != nil || len(priv) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("malformed private key for kid %q", kid)
	}
	return &signKey{kid: kid, priv: ed25519.PrivateKey(priv), pub: ed25519.PublicKey(pub)}, nil
}
