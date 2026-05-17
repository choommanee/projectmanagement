package auth

import (
    "net/http"
    "net/http/httptest"
    "testing"
    "time"
)

func TestRequireAuthRejectsMissing(t *testing.T) {
    _, pub := newKeySet(t)
    mw := Require(NewVerifier(pub, "iss"))
    h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }))
    rec := httptest.NewRecorder()
    h.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
    if rec.Code != 401 { t.Fatalf("want 401 got %d", rec.Code) }
}

func TestRequireAuthInjectsClaims(t *testing.T) {
    priv, pub := newKeySet(t)
    tok, _ := NewSigner(priv, "iss").Sign(Claims{Subject: "u1", TenantID: "t1", Roles: []string{"x"}, TTL: time.Minute})
    mw := Require(NewVerifier(pub, "iss"))
    h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        c := MustFromCtx(r.Context())
        if c.Subject != "u1" || c.TenantID != "t1" { t.Errorf("bad: %+v", c) }
        w.WriteHeader(204)
    }))
    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/", nil)
    req.Header.Set("Authorization", "Bearer "+tok)
    h.ServeHTTP(rec, req)
    if rec.Code != 204 { t.Fatalf("want 204 got %d", rec.Code) }
}

func TestTenantHeaderInjects(t *testing.T) {
    priv, pub := newKeySet(t)
    tok, _ := NewSigner(priv, "iss").Sign(Claims{Subject: "u", TenantID: "TENANT-XYZ", TTL: time.Minute})
    mw := Require(NewVerifier(pub, "iss"))
    chain := mw(TenantHeader(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if r.Header.Get("X-Tenant-Id") != "TENANT-XYZ" {
            t.Errorf("missing X-Tenant-Id: %v", r.Header)
        }
        w.WriteHeader(200)
    })))
    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/", nil)
    req.Header.Set("Authorization", "Bearer "+tok)
    chain.ServeHTTP(rec, req)
}
