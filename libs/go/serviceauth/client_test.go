package serviceauth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// fakeIdentity stands in for identity-svc's /v1/internal/service-token. It
// counts calls so tests can assert caching, and echoes back a token whose
// value encodes the call number so refresh is observable.
func fakeIdentity(t *testing.T, secret string, ttl time.Duration, calls *int64) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/internal/service-token" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if r.Header.Get("X-Service-Secret") != secret {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		var body tokenRequest
		_ = json.NewDecoder(r.Body).Decode(&body)
		n := atomic.AddInt64(calls, 1)
		_ = json.NewEncoder(w).Encode(tokenResponse{
			AccessToken: "tok-" + body.TenantID + "-" + itoa(n),
			ExpiresAt:   time.Now().Add(ttl),
		})
	}))
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func TestTokenFor_CachesUntilRefreshWindow(t *testing.T) {
	var calls int64
	srv := fakeIdentity(t, "s3cret", 10*time.Minute, &calls)
	defer srv.Close()

	c := New(srv.URL, "s3cret", "workflow-svc")

	tok1, err := c.TokenFor(context.Background(), "tenant-a")
	if err != nil {
		t.Fatalf("first TokenFor: %v", err)
	}
	tok2, err := c.TokenFor(context.Background(), "tenant-a")
	if err != nil {
		t.Fatalf("second TokenFor: %v", err)
	}
	if tok1 != tok2 {
		t.Fatalf("expected cached token, got %q then %q", tok1, tok2)
	}
	if got := atomic.LoadInt64(&calls); got != 1 {
		t.Fatalf("expected 1 identity-svc call (cached), got %d", got)
	}
}

func TestTokenFor_RefetchesPastRefreshWindow(t *testing.T) {
	var calls int64
	// 10m TTL -> refreshAt at 8m. Drive a virtual clock past that.
	srv := fakeIdentity(t, "s3cret", 10*time.Minute, &calls)
	defer srv.Close()

	c := New(srv.URL, "s3cret", "workflow-svc")
	base := time.Now()
	var virtual atomic.Int64
	virtual.Store(base.UnixNano())
	c.now = func() time.Time { return time.Unix(0, virtual.Load()) }

	tok1, err := c.TokenFor(context.Background(), "tenant-a")
	if err != nil {
		t.Fatal(err)
	}

	// Advance 9 minutes: past the 8m (80%) refresh window but before expiry.
	virtual.Store(base.Add(9 * time.Minute).UnixNano())

	tok2, err := c.TokenFor(context.Background(), "tenant-a")
	if err != nil {
		t.Fatal(err)
	}
	if tok1 == tok2 {
		t.Fatalf("expected refreshed token past 80%% TTL, both were %q", tok1)
	}
	if got := atomic.LoadInt64(&calls); got != 2 {
		t.Fatalf("expected 2 identity-svc calls (initial + refresh), got %d", got)
	}
}

func TestTokenFor_PerTenantIsolation(t *testing.T) {
	var calls int64
	srv := fakeIdentity(t, "s3cret", 10*time.Minute, &calls)
	defer srv.Close()

	c := New(srv.URL, "s3cret", "workflow-svc")
	ta, _ := c.TokenFor(context.Background(), "tenant-a")
	tb, _ := c.TokenFor(context.Background(), "tenant-b")
	if ta == tb {
		t.Fatalf("expected distinct tokens per tenant, both %q", ta)
	}
	if got := atomic.LoadInt64(&calls); got != 2 {
		t.Fatalf("expected 2 calls (one per tenant), got %d", got)
	}
}

func TestTokenFor_WrongSecretSurfacesError(t *testing.T) {
	var calls int64
	srv := fakeIdentity(t, "right-secret", 10*time.Minute, &calls)
	defer srv.Close()

	c := New(srv.URL, "wrong-secret", "workflow-svc")
	if _, err := c.TokenFor(context.Background(), "tenant-a"); err == nil {
		t.Fatal("expected error from wrong secret, got nil")
	}
}

func TestTokenFor_EmptyTenantRejected(t *testing.T) {
	c := New("http://unused", "s", "workflow-svc")
	if _, err := c.TokenFor(context.Background(), ""); err == nil {
		t.Fatal("expected error for empty tenant id")
	}
}

func TestTokenFor_FallsBackToValidCacheOnRefetchFailure(t *testing.T) {
	var calls int64
	var fail atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail.Load() {
			http.Error(w, "down", http.StatusServiceUnavailable)
			return
		}
		var body tokenRequest
		_ = json.NewDecoder(r.Body).Decode(&body)
		n := atomic.AddInt64(&calls, 1)
		_ = json.NewEncoder(w).Encode(tokenResponse{
			AccessToken: "tok-" + itoa(n),
			ExpiresAt:   time.Now().Add(10 * time.Minute),
		})
	}))
	defer srv.Close()

	c := New(srv.URL, "s", "workflow-svc")
	base := time.Now()
	var virtual atomic.Int64
	virtual.Store(base.UnixNano())
	c.now = func() time.Time { return time.Unix(0, virtual.Load()) }

	tok1, err := c.TokenFor(context.Background(), "tenant-a")
	if err != nil {
		t.Fatal(err)
	}

	// Past refresh window but before hard expiry; identity-svc now failing.
	fail.Store(true)
	virtual.Store(base.Add(9 * time.Minute).UnixNano())

	tok2, err := c.TokenFor(context.Background(), "tenant-a")
	if err != nil {
		t.Fatalf("expected fallback to cached token, got error: %v", err)
	}
	if tok2 != tok1 {
		t.Fatalf("expected stale-but-valid cached token, got %q", tok2)
	}
}
