package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	libauth "github.com/pmplatform/libs/go/auth"
	libpolicy "github.com/pmplatform/libs/policy"

	sjwt "github.com/pmplatform/services/identity-svc/internal/jwt"
)

// rotatePool prefers the project-native dev DB but honors TEST_DATABASE_URL.
func rotateTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	if err := p.Ping(context.Background()); err != nil {
		p.Close()
		t.Skipf("postgres ping failed: %v", err)
	}
	// Close registered FIRST so it runs AFTER per-test signing_key cleanups
	// (t.Cleanup is LIFO). A `defer p.Close()` at the call site closed the pool
	// before the cleanups ran, silently leaking test keys into the shared DB.
	t.Cleanup(p.Close)
	return p
}

// lockSigningKeys serializes signing_key tests ACROSS test binaries: `go test
// ./...` runs packages in parallel against the same shared dev Postgres, so a
// Rotate in one package can demote rows another package's test just seeded.
// A session-scoped advisory lock (held on a dedicated pooled conn for the
// test's duration) makes table-wide active-flag scenarios deterministic.
// Registered FIRST so the unlock cleanup runs LAST (after restores/deletes).
func lockSigningKeys(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	conn, err := p.Acquire(context.Background())
	if err != nil {
		t.Fatalf("acquire conn for advisory lock: %v", err)
	}
	if _, err := conn.Exec(context.Background(),
		"SELECT pg_advisory_lock(hashtext('signing_key_test'))"); err != nil {
		conn.Release()
		t.Fatalf("pg_advisory_lock: %v", err)
	}
	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(),
			"SELECT pg_advisory_unlock(hashtext('signing_key_test'))")
		conn.Release()
	})
}

// restoreActivesAfter snapshots the kids that are active right now and
// re-activates them when the test finishes. Tests that trigger Rotate demote
// every active row table-wide; without this, a test run left the live
// identity-svc's signing key demoted in the shared dev DB.
func restoreActivesAfter(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	rows, err := p.Query(context.Background(), "SELECT kid FROM signing_key WHERE active")
	if err != nil {
		t.Fatalf("snapshot actives: %v", err)
	}
	var saved []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			rows.Close()
			t.Fatalf("scan kid: %v", err)
		}
		saved = append(saved, k)
	}
	rows.Close()
	t.Cleanup(func() {
		for _, k := range saved {
			_, _ = p.Exec(context.Background(),
				"UPDATE signing_key SET active=true WHERE kid=$1", k)
		}
	})
}

// newSignedToken builds a JWT against the live Store (so it lands in the
// dynamic verifier's JWKS) for a user with the given roles.
func newSignedToken(t *testing.T, store *sjwt.Store, issuer string, roles []string) string {
	t.Helper()
	priv, kid := store.CurrentKey()
	if priv == nil {
		t.Fatal("store has no current key")
	}
	_ = kid // kid headers are already on the priv key
	signer := libauth.NewSigner(priv, issuer)
	tok, err := signer.Sign(libauth.Claims{
		Subject:  "sub-test",
		TenantID: "tenant-test",
		Roles:    roles,
		TTL:      5 * time.Minute,
	})
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return tok
}

func TestCedarGatesRotate_AllowsPlatformAdmin(t *testing.T) {
	p := rotateTestPool(t)
	lockSigningKeys(t, p)
	restoreActivesAfter(t, p)

	ctx := context.Background()
	kid := "cedar-allow-" + time.Now().Format("150405.000000")
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), "DELETE FROM signing_key WHERE kid LIKE 'cedar-allow-%' OR kid LIKE 'auto-%'")
	})
	kp, err := sjwt.LoadOrCreate(ctx, p, kid)
	if err != nil {
		t.Fatal(err)
	}
	ks := sjwt.NewStore(p, 24*time.Hour)
	ks.Bind(kp, kid)
	if err := ks.Refresh(ctx); err != nil {
		t.Fatalf("refresh: %v", err)
	}

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	issuer := "http://test/" + kid
	h := NewRouter(nil, kp, ks, issuer, &libpolicy.Adapter{Policies: ps})

	tok := newSignedToken(t, ks, issuer, []string{"platform-admin"})

	// Pass an explicit kid that the cleanup pattern above covers. Without a
	// body the handler defaults to "kid-<unixnano>", which the cleanup missed
	// — those rows leaked into the shared dev DB on every test run.
	req := httptest.NewRequest("POST", "/v1/admin/keys/rotate",
		strings.NewReader(`{"kid":"cedar-allow-rot-`+time.Now().Format("150405.000000")+`"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCedarGatesRotate_Denies403WithoutAdminRole(t *testing.T) {
	p := rotateTestPool(t)
	lockSigningKeys(t, p)

	ctx := context.Background()
	kid := "cedar-deny-" + time.Now().Format("150405.000000")
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), "DELETE FROM signing_key WHERE kid LIKE 'cedar-deny-%'")
	})
	kp, err := sjwt.LoadOrCreate(ctx, p, kid)
	if err != nil {
		t.Fatal(err)
	}
	ks := sjwt.NewStore(p, 24*time.Hour)
	ks.Bind(kp, kid)
	if err := ks.Refresh(ctx); err != nil {
		t.Fatalf("refresh: %v", err)
	}

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	issuer := "http://test/" + kid
	h := NewRouter(nil, kp, ks, issuer, &libpolicy.Adapter{Policies: ps})

	// User has roles, but none of them are platform-admin.
	tok := newSignedToken(t, ks, issuer, []string{"project-manager", "dashboard-viewer"})

	req := httptest.NewRequest("POST", "/v1/admin/keys/rotate", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403 got %d: %s", rec.Code, rec.Body.String())
	}
}
