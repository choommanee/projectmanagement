package api

import (
	"context"
	"encoding/json"
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

// policyReloadPool prefers the native :5432 dev DB; TEST_DATABASE_URL overrides.
func policyReloadPool(t *testing.T) *pgxpool.Pool {
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

// ensurePolicyBundleTable is duplicated from libs/policy's test because the
// two packages don't share test helpers; both pin the same schema.
func ensurePolicyBundleTable(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS policy_bundle (
		    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		    name        TEXT NOT NULL,
		    body        TEXT NOT NULL,
		    version     INTEGER NOT NULL DEFAULT 1,
		    active      BOOLEAN NOT NULL DEFAULT TRUE,
		    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
		    created_by  UUID NULL
		)`)
	if err != nil {
		t.Fatalf("create policy_bundle: %v", err)
	}
	_, err = pool.Exec(ctx, `CREATE UNIQUE INDEX IF NOT EXISTS policy_bundle_active_idx ON policy_bundle (active) WHERE active`)
	if err != nil {
		t.Fatalf("create policy_bundle index: %v", err)
	}
}

// seedReloadBundle wipes the active row, inserts a deterministic body, and
// returns its version. Cleanup re-activates the prior row if any.
func seedReloadBundle(t *testing.T, pool *pgxpool.Pool, name, body string, version int) {
	t.Helper()
	ctx := context.Background()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM policy_bundle WHERE name = $1`, name)
	})
	if _, err := pool.Exec(ctx, `UPDATE policy_bundle SET active = FALSE WHERE active`); err != nil {
		t.Fatalf("deactivate existing: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO policy_bundle (name, body, version, active) VALUES ($1, $2, $3, TRUE)`, name, body, version); err != nil {
		t.Fatalf("insert policy row: %v", err)
	}
}

// reloadBundleBody is a minimal Cedar source: enough to grant policy.reload to
// platform-admin so the reload endpoint itself stays callable after the swap.
const reloadBundleBody = `
permit (
  principal,
  action == Action::"policy.reload",
  resource
)
when { context.roles.contains("platform-admin") };

permit (
  principal,
  action == Action::"jwt.rotate",
  resource
)
when { context.roles.contains("platform-admin") };
`

func TestPolicyReload_AllowsPlatformAdmin(t *testing.T) {
	p := policyReloadPool(t)
	defer p.Close()
	ensurePolicyBundleTable(t, p)
	seedReloadBundle(t, p, "pmplatform-reload-allow", reloadBundleBody, 42)

	ctx := context.Background()
	kid := "reload-allow-" + time.Now().Format("150405.000000")
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), "DELETE FROM signing_key WHERE kid LIKE 'reload-allow-%'")
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

	// Build the router with the DynamicAdapter so the SAME authz instance
	// gates the route AND is the swap target — exactly the production wiring.
	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	dyn := libpolicy.NewDynamicAdapter(&libpolicy.Adapter{Policies: ps})
	issuer := "http://test/" + kid
	h := NewRouterWithPolicy(nil, kp, ks, issuer, dyn, dyn, p)

	tok := newSignedToken(t, ks, issuer, []string{"platform-admin"})

	req := httptest.NewRequest("POST", "/v1/admin/policy/reload", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d: %s", rec.Code, rec.Body.String())
	}
	var resp policyReloadResp
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode resp: %v body=%s", err, rec.Body.String())
	}
	if resp.Version != 42 {
		t.Fatalf("version: got %d want 42", resp.Version)
	}
	if resp.ReloadedAt.IsZero() {
		t.Fatal("reloaded_at must be set")
	}

	// Confirm the swap actually happened by exercising the new adapter
	// directly. The seeded body only permits policy.reload + jwt.rotate
	// for platform-admin, so a project-manager trying project.create —
	// which the embed allows — must now deny.
	cur := dyn.Current()
	if cur == nil {
		t.Fatal("dynAuthz.Current is nil after swap")
	}
	allow, err := cur.IsAllowed(libauth.AuthzRequest{
		Principal: `User::"x"`,
		Action:    `Action::"project.create"`,
		Resource:  `Resource::"*"`,
		Context:   map[string]any{"roles": []string{"project-manager"}},
	})
	if err != nil {
		t.Fatalf("post-swap IsAllowed: %v", err)
	}
	if allow {
		t.Fatal("seeded bundle should NOT permit project.create; swap did not take effect")
	}
}

func TestPolicyReload_Denies403WithoutAdminRole(t *testing.T) {
	p := policyReloadPool(t)
	defer p.Close()
	ensurePolicyBundleTable(t, p)
	seedReloadBundle(t, p, "pmplatform-reload-deny", reloadBundleBody, 1)

	ctx := context.Background()
	kid := "reload-deny-" + time.Now().Format("150405.000000")
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), "DELETE FROM signing_key WHERE kid LIKE 'reload-deny-%'")
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
	dyn := libpolicy.NewDynamicAdapter(&libpolicy.Adapter{Policies: ps})
	issuer := "http://test/" + kid
	h := NewRouterWithPolicy(nil, kp, ks, issuer, dyn, dyn, p)

	// Non-admin roles — RequireAction must reject before reload runs.
	tok := newSignedToken(t, ks, issuer, []string{"project-manager", "dashboard-viewer"})

	req := httptest.NewRequest("POST", "/v1/admin/policy/reload", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403 got %d: %s", rec.Code, strings.TrimSpace(rec.Body.String()))
	}
}
