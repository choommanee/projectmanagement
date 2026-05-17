package jwt

import (
	"crypto/rand"
	"crypto/rsa"

	"github.com/lestrrat-go/jwx/v2/jwk"
)

type KeyPair struct {
	Priv jwk.Key
}

func GenerateKeyPair(kid string) (*KeyPair, error) {
	raw, err := rsa.GenerateKey(rand.Reader, 2048)
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

func (kp *KeyPair) JWKS() (jwk.Set, error) {
	pub, err := kp.Priv.PublicKey()
	if err != nil {
		return nil, err
	}
	set := jwk.NewSet()
	if err := set.AddKey(pub); err != nil {
		return nil, err
	}
	return set, nil
}
