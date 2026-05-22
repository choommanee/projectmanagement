package policy

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	libauth "github.com/pmplatform/libs/go/auth"
)

// dbTestPool returns a live pool for the project-native dev Postgres on :5432.
// TEST_DATABASE_URL overrides if present. The test is skipped (not failed) when
// Postgres is unreachable so unit-only CI lanes still pass.
func dbTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("postgres ping failed: %v", err)
	}
	return pool
}

// ensurePolicyBundleTable creates the policy_bundle table on the fly so the
// test is self-contained when the migration hasn't been applied yet.
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

func TestLoadFromDB_ParsesActiveRow(t *testing.T) {
	pool := dbTestPool(t)
	defer pool.Close()
	ensurePolicyBundleTable(t, pool)

	ctx := context.Background()
	// Isolate: clear any active row, insert a deterministic body, and clean
	// up after.
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM policy_bundle WHERE name = 'pmplatform-test'`)
	})
	_, err := pool.Exec(ctx, `UPDATE policy_bundle SET active = FALSE WHERE active`)
	if err != nil {
		t.Fatalf("deactivate existing: %v", err)
	}
	t.Cleanup(func() {
		// Best-effort re-activate any other prior row we may have flipped.
		_, _ = pool.Exec(context.Background(), `UPDATE policy_bundle SET active = TRUE WHERE name <> 'pmplatform-test' AND NOT EXISTS (SELECT 1 FROM policy_bundle WHERE active)`)
	})

	body := `
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
	_, err = pool.Exec(ctx, `INSERT INTO policy_bundle (name, body, version, active) VALUES ($1, $2, $3, TRUE)`, "pmplatform-test", body, 7)
	if err != nil {
		t.Fatalf("insert policy row: %v", err)
	}

	ps, version, err := LoadFromDB(ctx, pool)
	if err != nil {
		t.Fatalf("LoadFromDB: %v", err)
	}
	if version != 7 {
		t.Fatalf("version: got %d want 7", version)
	}

	a := &Adapter{Policies: ps}
	allow, err := a.IsAllowed(libauth.AuthzRequest{
		Principal: `User::"sub-1"`,
		Action:    `Action::"policy.reload"`,
		Resource:  `Resource::"*"`,
		Context: map[string]any{
			"roles": []string{"platform-admin"},
		},
	})
	if err != nil {
		t.Fatalf("IsAllowed: %v", err)
	}
	if !allow {
		t.Fatal("platform-admin must be allowed to policy.reload via DB-loaded bundle")
	}

	// And a deny case: non-admin must not be allowed.
	allow, err = a.IsAllowed(libauth.AuthzRequest{
		Principal: `User::"sub-2"`,
		Action:    `Action::"policy.reload"`,
		Resource:  `Resource::"*"`,
		Context: map[string]any{
			"roles": []string{"project-manager"},
		},
	})
	if err != nil {
		t.Fatalf("IsAllowed: %v", err)
	}
	if allow {
		t.Fatal("non-admin must be denied policy.reload")
	}
}
