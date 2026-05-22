package auth

import (
    "context"
    "net/http"
    "strings"
)

type ctxKey int

const claimsKey ctxKey = 1

func Require(v *Verifier) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            tok := bearer(r)
            if tok == "" {
                http.Error(w, "missing token", 401)
                return
            }
            c, err := v.Verify(tok)
            if err != nil {
                http.Error(w, "invalid token", 401)
                return
            }
            ctx := context.WithValue(r.Context(), claimsKey, c)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}

func bearer(r *http.Request) string {
    h := r.Header.Get("Authorization")
    if !strings.HasPrefix(h, "Bearer ") {
        return ""
    }
    return strings.TrimPrefix(h, "Bearer ")
}

func MustFromCtx(ctx context.Context) *ParsedClaims {
    c, _ := ctx.Value(claimsKey).(*ParsedClaims)
    if c == nil {
        panic("auth claims missing — middleware not mounted?")
    }
    return c
}

func FromCtx(ctx context.Context) (*ParsedClaims, bool) {
    c, ok := ctx.Value(claimsKey).(*ParsedClaims)
    return c, ok
}

// WithClaims returns a copy of ctx with the given parsed claims attached
// under the same context key Require uses. Callers that need to verify a
// token outside the Require middleware (e.g. dynamic-JWKS verification)
// should use this helper so downstream FromCtx / MustFromCtx still work.
func WithClaims(ctx context.Context, c *ParsedClaims) context.Context {
    return context.WithValue(ctx, claimsKey, c)
}
