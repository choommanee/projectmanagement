package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeAuthorizer captures the last AuthzRequest it saw so tests can assert
// on principal/action/resource/attrs wiring. The allow predicate keeps the
// allow-vs-deny path explicit per case.
type fakeAuthorizer struct {
	allow bool
	err   error
	last  AuthzRequest
}

func (f *fakeAuthorizer) IsAllowed(r AuthzRequest) (bool, error) {
	f.last = r
	if f.err != nil {
		return false, f.err
	}
	return f.allow, nil
}

// fakeLoader returns canned attrs (or an error) and records the UID it saw.
type fakeLoader struct {
	attrs map[string]any
	err   error
	seen  string
}

func (l *fakeLoader) LoadAttrs(_ context.Context, uid string) (map[string]any, error) {
	l.seen = uid
	if l.err != nil {
		return nil, l.err
	}
	return l.attrs, nil
}

// withTestClaims is the test-internal version of identity-svc's withClaims
// helper: it injects ParsedClaims into the request context so the middleware
// can read them.
func withTestClaims(next http.Handler, c *ParsedClaims) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r.WithContext(WithClaims(r.Context(), c)))
	})
}

func TestRequireActionScoped_LiteralTemplatePassesThrough(t *testing.T) {
	az := &fakeAuthorizer{allow: true}
	mw := RequireActionScoped(az, "tenant.sso.configure", "Tenant::*")
	h := withTestClaims(mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(204)
	})), &ParsedClaims{Subject: "u", TenantID: "t1"})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/v1/tenants/sso", nil))

	if rec.Code != 204 {
		t.Fatalf("want 204, got %d", rec.Code)
	}
	if !strings.HasPrefix(az.last.Resource, "Resource::") && !strings.HasPrefix(az.last.Resource, "Tenant::") {
		t.Fatalf("resource not wrapped properly: %q", az.last.Resource)
	}
}

func TestRequireActionScoped_TemplateSubstitutesURLParam(t *testing.T) {
	prev := URLParam
	defer func() { URLParam = prev }()
	URLParam = func(_ *http.Request, key string) string {
		if key == "id" {
			return "abc-123"
		}
		return ""
	}

	az := &fakeAuthorizer{allow: true}
	mw := RequireActionScoped(az, "project.update", "Project::{:id}")
	h := withTestClaims(mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(204)
	})), &ParsedClaims{Subject: "u", TenantID: "t1"})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("PATCH", "/v1/projects/abc-123", nil))

	if rec.Code != 204 {
		t.Fatalf("want 204, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if az.last.Resource != `Project::"abc-123"` {
		t.Fatalf("resource not interpolated: got %q", az.last.Resource)
	}
}

func TestRequireActionScoped_LoaderPopulatesAttrs(t *testing.T) {
	prev := URLParam
	defer func() { URLParam = prev }()
	URLParam = func(_ *http.Request, _ string) string { return "p1" }

	loader := &fakeLoader{attrs: map[string]any{
		"tenant_id":  "t1",
		"owner_user": "u1",
	}}
	az := &fakeAuthorizer{allow: true}
	mw := RequireActionScoped(az, "project.update", "Project::{:id}", WithLoader(loader))
	h := withTestClaims(mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(204)
	})), &ParsedClaims{Subject: "u1", TenantID: "t1"})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("PATCH", "/v1/projects/p1", nil))

	if rec.Code != 204 {
		t.Fatalf("want 204, got %d", rec.Code)
	}
	if loader.seen != `Project::"p1"` {
		t.Fatalf("loader saw wrong UID: %q", loader.seen)
	}
	if az.last.ResourceAttrs["tenant_id"] != "t1" {
		t.Fatalf("attrs not forwarded: %+v", az.last.ResourceAttrs)
	}
	if az.last.ResourceAttrs["owner_user"] != "u1" {
		t.Fatalf("owner_user not forwarded: %+v", az.last.ResourceAttrs)
	}
}

func TestRequireActionScoped_LoaderErrorDenies403(t *testing.T) {
	prev := URLParam
	defer func() { URLParam = prev }()
	URLParam = func(_ *http.Request, _ string) string { return "p1" }

	loader := &fakeLoader{err: errors.New("db down")}
	az := &fakeAuthorizer{allow: true}
	mw := RequireActionScoped(az, "project.update", "Project::{:id}", WithLoader(loader))
	h := withTestClaims(mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(204)
	})), &ParsedClaims{Subject: "u", TenantID: "t1"})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("PATCH", "/v1/projects/p1", nil))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestRequireActionScoped_DenyMissingClaims(t *testing.T) {
	az := &fakeAuthorizer{allow: true}
	mw := RequireActionScoped(az, "project.update", "Project::{:id}")
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) }))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("PATCH", "/v1/projects/p1", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
}

func TestRequireActionScoped_NilAuthzIsNoOp(t *testing.T) {
	mw := RequireActionScoped(nil, "project.update", "Project::{:id}")
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) }))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("PATCH", "/v1/projects/p1", nil))
	if rec.Code != 204 {
		t.Fatalf("nil authz should pass through: got %d", rec.Code)
	}
}
