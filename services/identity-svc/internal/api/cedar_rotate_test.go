package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
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
	return p
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
	defer p.Close()

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

	req := httptest.NewRequest("POST", "/v1/admin/keys/rotate", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestCedarGatesRotate_Denies403WithoutAdminRole(t *testing.T) {
	p := rotateTestPool(t)
	defer p.Close()

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
