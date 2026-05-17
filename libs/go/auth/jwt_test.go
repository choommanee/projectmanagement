package auth

import (
    "crypto/rand"
    "crypto/rsa"
    "testing"
    "time"

    "github.com/lestrrat-go/jwx/v2/jwk"
)

func newKeySet(t *testing.T) (jwk.Key, jwk.Set) {
    priv, _ := rsa.GenerateKey(rand.Reader, 2048)
    privKey, _ := jwk.FromRaw(priv)
    _ = privKey.Set(jwk.KeyIDKey, "test-1")
    _ = privKey.Set(jwk.AlgorithmKey, "RS256")
    pubKey, _ := privKey.PublicKey()
    set := jwk.NewSet()
    _ = set.AddKey(pubKey)
    return privKey, set
}

func TestSignAndVerify(t *testing.T) {
    priv, pub := newKeySet(t)
    s := NewSigner(priv, "test-issuer")
    tok, err := s.Sign(Claims{
        Subject: "user-1", TenantID: "ten-1",
        Roles: []string{"admin"}, TTL: time.Minute,
    })
    if err != nil { t.Fatal(err) }
    v := NewVerifier(pub, "test-issuer")
    c, err := v.Verify(tok)
    if err != nil { t.Fatal(err) }
    if c.Subject != "user-1" || c.TenantID != "ten-1" || c.Roles[0] != "admin" {
        t.Fatalf("bad claims: %+v", c)
    }
}

func TestVerifyExpired(t *testing.T) {
    priv, pub := newKeySet(t)
    s := NewSigner(priv, "iss")
    // Sign with negative TTL → already expired.
    tok, err := s.Sign(Claims{Subject: "u", TenantID: "t", TTL: -1 * time.Minute})
    if err != nil { t.Fatal(err) }
    if _, err := NewVerifier(pub, "iss").Verify(tok); err == nil {
        t.Fatal("expected verify failure on expired token")
    }
}

func TestVerifyWrongIssuer(t *testing.T) {
    priv, pub := newKeySet(t)
    s := NewSigner(priv, "iss-1")
    tok, _ := s.Sign(Claims{Subject: "u", TenantID: "t", TTL: time.Minute})
    if _, err := NewVerifier(pub, "iss-2").Verify(tok); err == nil {
        t.Fatal("expected issuer mismatch failure")
    }
}
