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

// LoadOrCreate loads an existing signing key by kid from Postgres, or
// generates a new RSA-2048 key, persists it, and returns it.
//
// Boot must be IDEMPOTENT: a row for the configured kid may already exist in
// ANY state. After a key rotation the originally-configured JWT_KID row is
// marked active=false (superseded), so a previous active-only lookup found
// nothing, fell through to an INSERT, and crashed on the kid primary key.
// We therefore look the kid up regardless of its active flag and reuse it.
//
// To guarantee the DynamicSigner has something to mint with, if the loaded kid
// is inactive AND no other key is currently active, we re-activate it. If a
// different key is already active (a healthy post-rotation state) we leave the
// active flag untouched — main.go's keyStore.Refresh() then prefers that
// already-active key for signing, so we don't disrupt a live rotation.
//
// Kept as a free function for backward compatibility with bootstrap in main.
func LoadOrCreate(ctx context.Context, p *pgxpool.Pool, kid string) (*KeyPair, error) {
	var pemStr string
	var active bool
	err := p.QueryRow(ctx,
		"SELECT private_pem, active FROM signing_key WHERE kid=$1",
		kid,
	).Scan(&pemStr, &active)

	if errors.Is(err, pgx.ErrNoRows) {
		return create(ctx, p, kid)
	}
	if err != nil {
		return nil, err
	}

	// Row exists. If it is inactive and nothing else is active, re-activate it
	// so the signer has a usable active key on boot.
	if !active {
		if err := ensureActiveKey(ctx, p, kid); err != nil {
			return nil, err
		}
	}

	return decodeKeyPair(pemStr, kid)
}

// ensureActiveKey re-activates the given kid only if no key is currently
// active. The check + update run in a single statement so concurrent identity
// replicas can't both flip an extra key to active. A healthy rotation (some
// other key already active) is left completely untouched.
func ensureActiveKey(ctx context.Context, p *pgxpool.Pool, kid string) error {
	_, err := p.Exec(ctx,
		`UPDATE signing_key SET active = true
		 WHERE kid = $1
		   AND NOT EXISTS (SELECT 1 FROM signing_key WHERE active)`,
		kid,
	)
	return err
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

	// Insert the new key FIRST so the superseded_by FK on the old rows can
	// reference it, then atomically demote EVERY currently-active row (not
	// just one) in the same transaction. This is the invariant guarantee:
	// after commit exactly one row (newKid) is active, no matter how many
	// were active before (legacy pollution left 3 actives simultaneously).
	if _, err := tx.Exec(ctx,
		`INSERT INTO signing_key(kid, private_pem, public_jwk, active)
		 VALUES ($1, $2, $3, true)`,
		newKid, string(pemBytes), pubJSON,
	); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE signing_key
		    SET active=false, superseded_by=$1, superseded_at=now()
		  WHERE active AND kid <> $1`,
		newKid,
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

// JWKS returns the public JWK set. It ALWAYS publishes:
//   - every DB row flagged active (regardless of age — an active/minting key
//     must never be excluded by the grace window), plus
//   - rotated-out (inactive) keys whose age is within jwksMaxAge, plus
//   - the in-memory minting kid (from the DynamicSigner's CurrentKey), even if
//     its DB row was demoted by a concurrent rotation and has aged past grace.
//
// That last clause is the anti-desync invariant: the kid the running signer
// mints with is GUARANTEED present in JWKS, so a fresh JWKS fetch (or a service
// restarted after) can always verify freshly-minted tokens. The earlier
// platform-wide 401 happened precisely because the in-memory minting kid had
// been demoted in the DB and aged past grace, so JWKS (built purely from the
// DB) dropped it while the signer kept minting with it.
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

	// Invariant guard: ensure the in-memory minting kid is always published.
	// We derive its public key directly from the cached private key so this
	// holds even if the DB row was demoted/aged-out or deleted entirely.
	if priv, kid := s.CurrentKey(); priv != nil && kid != "" {
		if _, present := set.LookupKeyID(kid); !present {
			if pub, perr := priv.PublicKey(); perr == nil {
				_ = pub.Set(jwk.KeyIDKey, kid)
				_ = pub.Set(jwk.AlgorithmKey, "RS256")
				_ = set.AddKey(pub)
			}
		}
	}
	return set, nil
}

// ReconcileActive collapses the signing_key table to EXACTLY ONE active row and
// binds the in-memory minting key to it. Call this once at boot, after the
// bootstrap Bind, so DB + in-memory signer + JWKS all agree on a single kid.
//
// Behavior:
//   - 0 active rows: nothing to collapse; returns ("", nil) and leaves the
//     in-memory bootstrap bind (set by the caller) in place.
//   - 1 active row: binds to it (idempotent) and returns its kid.
//   - >1 active rows (legacy pollution / a half-finished rotation): keeps the
//     NEWEST by created_at as the sole active and demotes the rest in the same
//     transaction, recording superseded_by/superseded_at, then binds to it.
//
// This guarantees a freshly-restarted service mints with the one active key,
// which JWKS publishes — closing the boot-consistency hole.
func (s *Store) ReconcileActive(ctx context.Context) (string, error) {
	tx, err := s.p.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var newest string
	err = tx.QueryRow(ctx,
		`SELECT kid FROM signing_key WHERE active ORDER BY created_at DESC LIMIT 1`,
	).Scan(&newest)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}

	// Demote any other active rows so exactly one remains active.
	if _, err := tx.Exec(ctx,
		`UPDATE signing_key
		    SET active=false, superseded_by=$1, superseded_at=now()
		  WHERE active AND kid <> $1`,
		newest,
	); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}

	// Load the surviving active key and bind it in-memory so the signer mints
	// with the same kid the DB considers active and JWKS publishes.
	kp, kid, err := s.Active(ctx)
	if err != nil {
		return "", err
	}
	s.Bind(kp, kid)
	return kid, nil
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

	// ON CONFLICT DO NOTHING + RETURNING makes the insert idempotent: if a
	// concurrent boot (or a prior rotation) already created this kid, the
	// INSERT no-ops and RETURNING yields no row, so we fall back to loading
	// the persisted material instead of crashing on the kid primary key.
	//
	// active is computed, NOT left to the column default (true): a brand-new
	// key becomes active only when NO other key is currently active. Relying
	// on the default meant every key creation (tests, parallel boots) silently
	// added ANOTHER active row — the exactly-one-active invariant breach that
	// left 3 simultaneous actives in the incident. Bootstrap on an empty table
	// still yields an active key; creation alongside a healthy active key
	// yields an inactive one (ReconcileActive/Rotate own the active flag).
	var insertedPem string
	err = p.QueryRow(ctx,
		`INSERT INTO signing_key(kid, private_pem, public_jwk, active)
		 VALUES ($1, $2, $3, NOT EXISTS (SELECT 1 FROM signing_key WHERE active))
		 ON CONFLICT (kid) DO NOTHING
		 RETURNING private_pem`,
		kid, string(pemBytes), pubJSON,
	).Scan(&insertedPem)

	if errors.Is(err, pgx.ErrNoRows) {
		// Row already existed — reuse it (idempotent boot, including the
		// post-rotation case where the configured kid is now inactive).
		return LoadOrCreate(ctx, p, kid)
	}
	if err != nil {
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
