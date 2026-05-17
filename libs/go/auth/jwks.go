package auth

import (
    "context"
    "time"

    "github.com/lestrrat-go/jwx/v2/jwk"
)

func CachedJWKS(ctx context.Context, url string) (jwk.Set, error) {
    c := jwk.NewCache(ctx)
    if err := c.Register(url, jwk.WithMinRefreshInterval(time.Hour)); err != nil {
        return nil, err
    }
    if _, err := c.Refresh(ctx, url); err != nil {
        return nil, err
    }
    return jwk.NewCachedSet(c, url), nil
}
