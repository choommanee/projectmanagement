package jwt

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lestrrat-go/jwx/v2/jwk"
)

// DefaultJWKSMaxAge is the rotation grace window: rotated-out keys remain
// published in JWKS until they are older than this so tokens minted just
// before a rotation still verify against the public key set.
const DefaultJWKSMaxAge = 24 * time.Hour

// Store owns Postgres-backed signing-key lifecycle: bootstrap, rotate,
// publish to JWKS, and expose the currently-active signing key to the
// signer at request time (so rotation takes effect without restart).
type Store struct {
	p          *pgxpool.Pool
	jwksMaxAge time.Duration

	// current holds *currentKey atomically. Replaced on Rotate / Refresh
	// so signers always see the latest active key without locking.
	current atomic.Value // *currentKey
}

// currentKey bundles a private jwk.Key with its kid for atomic publication.
type currentKey struct {
	priv jwk.Key
	kid  string
}

// NewStore creates a Store. Pass 0 for jwksMaxAge to use DefaultJWKSMaxAge.
//
// The Store does not load the active key on construction — call Bind to seed
// the current-key cache (typically from the bootstrap KeyPair the service
// loaded at startup) or Refresh to pull the active row from Postgres.
func NewStore(p *pgxpool.Pool, jwksMaxAge time.Duration) *Store {
	if jwksMaxAge <= 0 {
		jwksMaxAge = DefaultJWKSMaxAge
	}
	return &Store{p: p, jwksMaxAge: jwksMaxAge}
}

// Bind seeds the in-memory current-key cache with the given keypair + kid.
// Use this immediately after LoadOrCreate at service startup so CurrentKey()
// is non-nil before the first sign call.
func (s *Store) Bind(kp *KeyPair, kid string) {
	if kp == nil || kp.Priv == nil {
		return
	}
	s.current.Store(&currentKey{priv: kp.Priv, kid: kid})
}

// Refresh re-reads the active key from Postgres and replaces the current-key
// cache. Useful if multiple identity-svc replicas rotate concurrently.
func (s *Store) Refresh(ctx context.Context) error {
	kp, kid, err := s.Active(ctx)
	if err != nil {
		return err
	}
	s.Bind(kp, kid)
	return nil
}

// CurrentKey returns the active private signing key and its kid. The returned
// jwk.Key already carries kid + alg headers, so a libauth.Signer built from it
// will emit tokens with the correct kid.
//
// Returns (nil, "") if neither Bind nor Refresh has populated the cache yet —
// callers (the signer wrapper) treat that as "service not ready".
func (s *Store) CurrentKey() (jwk.Key, string) {
	v := s.current.Load()
	if v == nil {
		return nil, ""
	}
	ck := v.(*currentKey)
	return ck.priv, ck.kid
}

// LoadOrCreate loads an existing active signing key by kid from Postgres, or
// generates a new RSA-2048 key, persists it, and returns it.
//
// Kept as a free function for backward compatibility with bootstrap in main.
func LoadOrCreate(ctx context.Context, p *pgxpool.Pool, kid string) (*KeyPair, error) {
	var pemStr string
	err := p.QueryRow(ctx,
		"SELECT private_pem FROM signing_key WHERE kid=$1 AND active",
		kid,
	).Scan(&pemStr)

	if errors.Is(err, pgx.ErrNoRows) {
		return create(ctx, p, kid)
	}
	if err != nil {
		return nil, err
	}

	return decodeKeyPair(pemStr, kid)
}

// Active returns the currently active signing keypair and its kid. If multiple
// rows have active=true (which should not happen in healthy state), the most
// recently created one wins.
func (s *Store) Active(ctx context.Context) (*KeyPair, string, error) {
	var kid, pemStr string
	err := s.p.QueryRow(ctx,
		`SELECT kid, private_pem FROM signing_key
		 WHERE active
		 ORDER BY created_at DESC
		 LIMIT 1`,
	).Scan(&kid, &pemStr)
	if err != nil {
		return nil, "", err
	}
	kp, err := decodeKeyPair(pemStr, kid)
	if err != nil {
		return nil, "", err
	}
	return kp, kid, nil
}

// Rotate generates a fresh RSA-2048 keypair, marks all existing keys inactive,
// and inserts the new key as active=true. Returns the new keypair and its kid.
//
// The previously-active key remains in the table — it stays published in JWKS
// until older than jwksMaxAge so in-flight tokens still verify.
func (s *Store) Rotate(ctx context.Context, newKid string) (*KeyPair, error) {
	raw, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}

	pemBytes := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(raw),
	})

	priv, err := jwk.FromRaw(raw)
	if err != nil {
		return nil, err
	}
	_ = priv.Set(jwk.KeyIDKey, newKid)
	_ = priv.Set(jwk.AlgorithmKey, "RS256")

	pub, err := priv.PublicKey()
	if err != nil {
		return nil, err
	}
	pubJSON, err := json.Marshal(pub)
	if err != nil {
		return nil, err
	}

	tx, err := s.p.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx,
		`UPDATE signing_key SET active=false WHERE active`,
	); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO signing_key(kid, private_pem, public_jwk, active)
		 VALUES ($1, $2, $3, true)`,
		newKid, string(pemBytes), pubJSON,
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	kp := &KeyPair{Priv: priv}
	// Swap the in-memory active key so subsequent signs use the new kid
	// without requiring a process restart.
	s.Bind(kp, newKid)
	return kp, nil
}

// JWKS returns the public JWK set, including the active key plus any
// rotated-out keys whose age is within jwksMaxAge.
func (s *Store) JWKS(ctx context.Context) (jwk.Set, error) {
	rows, err := s.p.Query(ctx,
		`SELECT public_jwk FROM signing_key
		 WHERE active OR created_at >= now() - $1::interval
		 ORDER BY created_at DESC`,
		s.jwksMaxAge.String(),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	set := jwk.NewSet()
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		k, err := jwk.ParseKey(raw)
		if err != nil {
			return nil, err
		}
		if err := set.AddKey(k); err != nil {
			return nil, err
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return set, nil
}

func create(ctx context.Context, p *pgxpool.Pool, kid string) (*KeyPair, error) {
	raw, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}

	pemBytes := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(raw),
	})

	priv, err := jwk.FromRaw(raw)
	if err != nil {
		return nil, err
	}
	_ = priv.Set(jwk.KeyIDKey, kid)
	_ = priv.Set(jwk.AlgorithmKey, "RS256")

	pub, err := priv.PublicKey()
	if err != nil {
		return nil, err
	}
	pubJSON, err := json.Marshal(pub)
	if err != nil {
		return nil, err
	}

	if _, err := p.Exec(ctx,
		`INSERT INTO signing_key(kid, private_pem, public_jwk) VALUES ($1, $2, $3)`,
		kid, string(pemBytes), pubJSON,
	); err != nil {
		return nil, err
	}

	return &KeyPair{Priv: priv}, nil
}

func decodeKeyPair(pemStr, kid string) (*KeyPair, error) {
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return nil, errors.New("invalid pem in database")
	}
	raw, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	priv, err := jwk.FromRaw(raw)
	if err != nil {
		return nil, err
	}
	_ = priv.Set(jwk.KeyIDKey, kid)
	_ = priv.Set(jwk.AlgorithmKey, "RS256")
	return &KeyPair{Priv: priv}, nil
}
