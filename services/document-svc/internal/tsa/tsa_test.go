package tsa

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// fixtureMsg is the exact message the recorded freetsa.org token was issued
// over (see testdata/freetsa_fixture.tsr, captured 2026-06-06). Tests use the
// fixture so they never need network egress.
const fixtureMsg = "fixture-chained-hash-v1"

func loadFixture(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "freetsa_fixture.tsr"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return b
}

func TestVerifyFixtureImprintMatches(t *testing.T) {
	tok := loadFixture(t)
	res := Verify(tok, []byte(fixtureMsg))
	if !res.Present {
		t.Fatal("expected token present")
	}
	if res.Error != "" {
		t.Fatalf("unexpected error: %s", res.Error)
	}
	if !res.ImprintMatches {
		t.Fatal("expected message imprint to match the fixture message")
	}
	if res.GenTime.IsZero() {
		t.Fatal("expected non-zero genTime from token")
	}
}

func TestVerifyTamperedMessageFails(t *testing.T) {
	tok := loadFixture(t)
	res := Verify(tok, []byte("some-other-chained-hash"))
	if !res.Present {
		t.Fatal("expected token present")
	}
	if res.ImprintMatches {
		t.Fatal("imprint must NOT match a different message")
	}
}

func TestVerifyMissingToken(t *testing.T) {
	res := Verify(nil, []byte(fixtureMsg))
	if res.Present {
		t.Fatal("nil token must report present=false")
	}
}

func TestVerifyGarbageToken(t *testing.T) {
	res := Verify([]byte("not-a-der-token"), []byte(fixtureMsg))
	if !res.Present || res.Error == "" {
		t.Fatalf("garbage token should be present with parse error, got %+v", res)
	}
}

// TestClientAgainstLocalServer exercises the full request path against an
// httptest server replaying the recorded fixture (no egress). The replayed
// imprint won't match an arbitrary new message, so we only assert transport +
// parse mechanics here; imprint semantics are covered by the fixture tests.
func TestClientAgainstLocalServer(t *testing.T) {
	tok := loadFixture(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ct := r.Header.Get("Content-Type"); ct != "application/timestamp-query" {
			t.Errorf("unexpected content type %q", ct)
		}
		w.Header().Set("Content-Type", "application/timestamp-reply")
		_, _ = w.Write(tok)
	}))
	defer srv.Close()

	c := New(srv.URL)
	der, genTime, err := c.Timestamp(context.Background(), []byte(fixtureMsg))
	if err != nil {
		t.Fatalf("Timestamp: %v", err)
	}
	if len(der) == 0 || genTime.IsZero() {
		t.Fatal("expected token bytes and genTime")
	}
	// And the returned token verifies against the fixture message.
	if res := Verify(der, []byte(fixtureMsg)); !res.ImprintMatches {
		t.Fatalf("round-tripped token should match fixture message: %+v", res)
	}
}

func TestClientUnreachableFailsFast(t *testing.T) {
	c := New("http://127.0.0.1:1") // nothing listens here
	if _, _, err := c.Timestamp(context.Background(), []byte("x")); err == nil {
		t.Fatal("expected error from unreachable TSA")
	}
}

func TestNilClientDisabled(t *testing.T) {
	var c *Client
	if _, _, err := c.Timestamp(context.Background(), []byte("x")); err == nil {
		t.Fatal("nil client must error (callers degrade to local)")
	}
}
