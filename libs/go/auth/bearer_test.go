package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestAttachClaims_NoHeader_PassesThrough(t *testing.T) {
	_, pub := newKeySet(t)
	called := false
	mw := AttachClaims(NewVerifier(pub, "iss"))
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if _, ok := FromCtx(r.Context()); ok {
			t.Errorf("expected no claims in ctx when no Authorization header")
		}
		w.WriteHeader(200)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if !called {
		t.Fatal("next handler was not invoked")
	}
	if rec.Code != 200 {
		t.Fatalf("want 200 got %d", rec.Code)
	}
}

func TestAttachClaims_ValidBearer_AttachesClaims(t *testing.T) {
	priv, pub := newKeySet(t)
	tok, err := NewSigner(priv, "iss").Sign(Claims{Subject: "u1", TenantID: "t1", Roles: []string{"r1"}, TTL: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	mw := AttachClaims(NewVerifier(pub, "iss"))
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, ok := FromCtx(r.Context())
		if !ok || c == nil {
			t.Fatal("expected claims in ctx")
		}
		if c.Subject != "u1" || c.TenantID != "t1" {
			t.Errorf("bad claims: %+v", c)
		}
		w.WriteHeader(204)
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	h.ServeHTTP(rec, req)
	if rec.Code != 204 {
		t.Fatalf("want 204 got %d", rec.Code)
	}
}

func TestAttachClaims_InvalidBearer_PassesThroughNoClaims(t *testing.T) {
	_, pub := newKeySet(t)
	called := false
	mw := AttachClaims(NewVerifier(pub, "iss"))
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if _, ok := FromCtx(r.Context()); ok {
			t.Errorf("expected no claims in ctx on invalid token")
		}
		w.WriteHeader(200)
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer not-a-real-jwt")
	h.ServeHTTP(rec, req)
	if !called {
		t.Fatal("next handler was not invoked on invalid token")
	}
	if rec.Code != 200 {
		t.Fatalf("want 200 got %d (no early 401 on bad token)", rec.Code)
	}
}

func TestAttachClaims_NilVerifier_PassesThrough(t *testing.T) {
	called := false
	mw := AttachClaims(nil)
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if _, ok := FromCtx(r.Context()); ok {
			t.Errorf("expected no claims in ctx when verifier is nil")
		}
		w.WriteHeader(200)
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/", nil)
	req.Header.Set("Authorization", "Bearer some-token")
	h.ServeHTTP(rec, req)
	if !called {
		t.Fatal("next handler was not invoked")
	}
}
