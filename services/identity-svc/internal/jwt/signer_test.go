package jwt

import (
	"testing"
	"time"

	libauth "github.com/pmplatform/libs/go/auth"
)

func TestKeyPairRoundtrip(t *testing.T) {
	kp, err := GenerateKeyPair("kid-1")
	if err != nil {
		t.Fatal(err)
	}
	tok, err := libauth.NewSigner(kp.Priv, "iss").Sign(libauth.Claims{
		Subject: "u", TenantID: "t", TTL: time.Minute,
	})
	if err != nil {
		t.Fatal(err)
	}
	set, _ := kp.JWKS()
	if _, err := libauth.NewVerifier(set, "iss").Verify(tok); err != nil {
		t.Fatal(err)
	}
}
