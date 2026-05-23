package auth

import (
	"context"
	"errors"
	"time"

	"github.com/lestrrat-go/jwx/v2/jwk"
)

// FetchJWKS retrieves a remote JWKS once with a short timeout. This is the
// minimum to bootstrap a product service that just needs to verify tokens
// minted by identity-svc — for production deployments prefer CachedJWKS
// (in jwks.go) which layers periodic refresh on top of the same fetch.
//
// Returns an error on empty URL or network failure. Callers should treat a
// fetch failure as non-fatal at startup (services keep listening but reject
// all JWT-bearing requests until restart) so a transient identity-svc outage
// doesn't take down every product service.
func FetchJWKS(ctx context.Context, url string) (jwk.Set, error) {
	if url == "" {
		return nil, errors.New("empty JWKS url")
	}
	cctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return jwk.Fetch(cctx, url)
}
