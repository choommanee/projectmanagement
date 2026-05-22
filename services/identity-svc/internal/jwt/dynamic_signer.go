package jwt

import (
	"errors"

	libauth "github.com/pmplatform/libs/go/auth"
)

// DynamicSigner is a libauth.Signer-compatible wrapper that resolves the
// active signing key from a Store on every Sign call. This is what closes the
// rotation loop: after Store.Rotate, the next call to Sign produces a token
// signed by the new key (and carrying the new kid header) without restarting
// the process.
type DynamicSigner struct {
	store  *Store
	issuer string
}

// NewDynamicSigner builds a signer that pulls the active key from store on
// each Sign call. issuer is propagated to the underlying libauth.Signer.
func NewDynamicSigner(store *Store, issuer string) *DynamicSigner {
	return &DynamicSigner{store: store, issuer: issuer}
}

// Sign signs the claims with the currently-active key. Returns an error if
// the Store has not been bound to a key yet.
func (d *DynamicSigner) Sign(c libauth.Claims) (string, error) {
	priv, _ := d.store.CurrentKey()
	if priv == nil {
		return "", errors.New("identity-svc signer not initialized: no active signing key")
	}
	// libauth.Signer is cheap (just holds the key + issuer) so building one
	// per call is fine and keeps the kid header in sync with the active key.
	return libauth.NewSigner(priv, d.issuer).Sign(c)
}
