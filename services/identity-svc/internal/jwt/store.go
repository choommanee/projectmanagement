package jwt

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/lestrrat-go/jwx/v2/jwk"
)

// LoadOrCreate loads an existing active signing key by kid from Postgres, or
// generates a new RSA-2048 key, persists it, and returns it.
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
