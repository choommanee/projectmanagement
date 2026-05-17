package auth

import (
    "errors"
    "time"

    "github.com/google/uuid"
    "github.com/lestrrat-go/jwx/v2/jwa"
    "github.com/lestrrat-go/jwx/v2/jwk"
    "github.com/lestrrat-go/jwx/v2/jws"
    "github.com/lestrrat-go/jwx/v2/jwt"
)

type Claims struct {
    Subject  string
    TenantID string
    Roles    []string
    TTL      time.Duration
}

type ParsedClaims struct {
    Subject  string
    TenantID string
    Roles    []string
    ExpireAt time.Time
}

type Signer struct {
    key    jwk.Key
    issuer string
}

func NewSigner(key jwk.Key, issuer string) *Signer { return &Signer{key: key, issuer: issuer} }

func (s *Signer) Sign(c Claims) (string, error) {
    if c.TTL == 0 {
        c.TTL = 15 * time.Minute
    }
    tok, err := jwt.NewBuilder().
        Issuer(s.issuer).
        Subject(c.Subject).
        IssuedAt(time.Now()).
        Expiration(time.Now().Add(c.TTL)).
        JwtID(uuid.NewString()).
        Claim("tid", c.TenantID).
        Claim("roles", c.Roles).
        Build()
    if err != nil {
        return "", err
    }
    signed, err := jwt.Sign(tok, jwt.WithKey(jwa.RS256, s.key))
    if err != nil {
        return "", err
    }
    return string(signed), nil
}

type Verifier struct {
    keys   jwk.Set
    issuer string
}

func NewVerifier(keys jwk.Set, issuer string) *Verifier { return &Verifier{keys: keys, issuer: issuer} }

func (v *Verifier) Verify(token string) (*ParsedClaims, error) {
    tok, err := jwt.Parse([]byte(token),
        jwt.WithKeySet(v.keys, jws.WithInferAlgorithmFromKey(true)),
        jwt.WithIssuer(v.issuer),
        jwt.WithValidate(true),
    )
    if err != nil {
        return nil, err
    }
    out := &ParsedClaims{
        Subject:  tok.Subject(),
        ExpireAt: tok.Expiration(),
    }
    if val, ok := tok.Get("tid"); ok {
        out.TenantID, _ = val.(string)
    }
    if val, ok := tok.Get("roles"); ok {
        if arr, ok := val.([]any); ok {
            for _, e := range arr {
                if s, ok := e.(string); ok {
                    out.Roles = append(out.Roles, s)
                }
            }
        }
    }
    if out.ExpireAt.Before(time.Now()) {
        return nil, errors.New("token expired")
    }
    return out, nil
}
