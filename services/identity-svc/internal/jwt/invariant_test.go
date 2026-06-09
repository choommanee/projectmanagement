package jwt

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

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

// deactivateAllActives snapshots every currently-active kid, deactivates them
// for the duration of the test, and restores them on cleanup. This lets a test
// assert table-wide active invariants deterministically even on the shared dev
// DB where the live identity-svc (and concurrent tests) may hold active rows.
func deactivateAllActives(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	rows, err := p.Query(ctx, `SELECT kid FROM signing_key WHERE active`)
	if err != nil {
		t.Fatalf("snapshot actives: %v", err)
	}
	var saved []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			rows.Close()
			t.Fatalf("scan: %v", err)
		}
		saved = append(saved, k)
	}
	rows.Close()
	if _, err := p.Exec(ctx, `UPDATE signing_key SET active=false WHERE active`); err != nil {
		t.Fatalf("deactivate all: %v", err)
	}
	t.Cleanup(func() {
		for _, k := range saved {
			_, _ = p.Exec(context.Background(),
				`UPDATE signing_key SET active=true WHERE kid=$1`, k)
		}
	})
}

func countActive(t *testing.T, p *pgxpool.Pool, kids ...string) int {
	t.Helper()
	var n int
	if err := p.QueryRow(context.Background(),
		`SELECT count(*) FROM signing_key WHERE active AND kid = ANY($1)`, kids,
	).Scan(&n); err != nil {
		t.Fatalf("count active: %v", err)
	}
	return n
}

// TestRotateCollapsesMultipleActivesToExactlyOne reproduces the polluted-table
// state we hit in production: several rows active=true simultaneously. After a
// single Rotate, EXACTLY ONE row (the new kid) must be active.
func TestRotateCollapsesMultipleActivesToExactlyOne(t *testing.T) {
	p := rotatePool(t)
	lockSigningKeys(t, p)
	ctx := context.Background()

	deactivateAllActives(t, p)

	suffix := uniqSuffix(t)
	k1 := "inv-a-" + suffix
	k2 := "inv-b-" + suffix
	k3 := "inv-c-" + suffix
	newKid := "inv-new-" + suffix
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(),
			`DELETE FROM signing_key WHERE kid = ANY($1)`,
			[]string{k1, k2, k3, newKid})
	})

	// Seed three SIMULTANEOUSLY-active rows (the broken invariant).
	for _, k := range []string{k1, k2, k3} {
		if _, err := LoadOrCreate(ctx, p, k); err != nil {
			t.Fatalf("seed %s: %v", k, err)
		}
		if _, err := p.Exec(ctx, `UPDATE signing_key SET active=true WHERE kid=$1`, k); err != nil {
			t.Fatalf("force active %s: %v", k, err)
		}
	}
	if got := countActive(t, p, k1, k2, k3); got != 3 {
		t.Fatalf("precondition: expected 3 actives, got %d", got)
	}

	s := NewStore(p, 24*time.Hour)
	if _, err := s.Rotate(ctx, newKid); err != nil {
		t.Fatalf("rotate: %v", err)
	}

	// Invariant: exactly one active across all four kids, and it is newKid.
	if got := countActive(t, p, k1, k2, k3, newKid); got != 1 {
		t.Fatalf("after rotate: expected exactly 1 active, got %d", got)
	}
	if got := countActive(t, p, newKid); got != 1 {
		t.Fatalf("new kid %q must be the active one", newKid)
	}

	// (c) The previously-active kids must remain published in JWKS within grace
	// so tokens minted just before the rotation still verify.
	set, err := s.JWKS(ctx)
	if err != nil {
		t.Fatalf("JWKS: %v", err)
	}
	kids := map[string]bool{}
	for _, k := range jwksKids(t, set) {
		kids[k] = true
	}
	if !kids[newKid] {
		t.Fatalf("new minting kid %q missing from JWKS", newKid)
	}
	for _, prev := range []string{k1, k2, k3} {
		if !kids[prev] {
			t.Fatalf("previously-active kid %q dropped from JWKS within grace", prev)
		}
	}
}

// TestJWKSAlwaysContainsInMemoryMintingKid is the direct regression test for the
// platform-wide 401: the signer's in-memory minting kid had been demoted in the
// DB and aged PAST the grace window, so JWKS (built purely from the DB) dropped
// it. JWKS must publish the in-memory minting kid unconditionally.
func TestJWKSAlwaysContainsInMemoryMintingKid(t *testing.T) {
	p := rotatePool(t)
	lockSigningKeys(t, p)
	ctx := context.Background()

	suffix := uniqSuffix(t)
	kid := "inv-mint-" + suffix
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM signing_key WHERE kid=$1`, kid)
	})

	kp, err := LoadOrCreate(ctx, p, kid)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	// Worst case: row is inactive AND created 30 days ago (far past grace).
	if _, err := p.Exec(ctx,
		`UPDATE signing_key SET active=false, created_at = now() - interval '30 days' WHERE kid=$1`,
		kid,
	); err != nil {
		t.Fatalf("demote+backdate: %v", err)
	}

	// 1h grace -> the DB query alone would exclude this kid entirely.
	s := NewStore(p, time.Hour)
	s.Bind(kp, kid) // signer is still minting with it

	set, err := s.JWKS(ctx)
	if err != nil {
		t.Fatalf("JWKS: %v", err)
	}
	found := false
	for _, k := range jwksKids(t, set) {
		if k == kid {
			found = true
		}
	}
	if !found {
		t.Fatalf("in-memory minting kid %q MUST be in JWKS even when demoted+aged", kid)
	}
}

// TestReconcileActiveCollapsesToNewest verifies boot consistency: multiple
// legacy actives are reduced to exactly one (the newest) and the in-memory
// signer is bound to it.
func TestReconcileActiveCollapsesToNewest(t *testing.T) {
	p := rotatePool(t)
	lockSigningKeys(t, p)
	ctx := context.Background()

	deactivateAllActives(t, p)

	suffix := uniqSuffix(t)
	older := "inv-old-" + suffix
	newer := "inv-newest-" + suffix
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(),
			`DELETE FROM signing_key WHERE kid = ANY($1)`, []string{older, newer})
	})

	for _, k := range []string{older, newer} {
		if _, err := LoadOrCreate(ctx, p, k); err != nil {
			t.Fatalf("seed %s: %v", k, err)
		}
		if _, err := p.Exec(ctx, `UPDATE signing_key SET active=true WHERE kid=$1`, k); err != nil {
			t.Fatalf("force active %s: %v", k, err)
		}
	}
	// Make `older` deterministically older than `newer`.
	if _, err := p.Exec(ctx,
		`UPDATE signing_key SET created_at = now() - interval '1 hour' WHERE kid=$1`, older,
	); err != nil {
		t.Fatalf("backdate older: %v", err)
	}
	if got := countActive(t, p, older, newer); got != 2 {
		t.Fatalf("precondition: expected 2 actives, got %d", got)
	}

	s := NewStore(p, 24*time.Hour)
	gotKid, err := s.ReconcileActive(ctx)
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if gotKid != newer {
		t.Fatalf("reconcile kept %q, want newest %q", gotKid, newer)
	}
	if got := countActive(t, p, older, newer); got != 1 {
		t.Fatalf("after reconcile: expected exactly 1 active, got %d", got)
	}
	if got := countActive(t, p, newer); got != 1 {
		t.Fatalf("newest %q must be the surviving active", newer)
	}
	// In-memory signer must mint with the reconciled kid.
	if _, kid := s.CurrentKey(); kid != newer {
		t.Fatalf("CurrentKey kid = %q, want %q", kid, newer)
	}
}
