package jwt

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func newPool(t *testing.T) *pgxpool.Pool {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	// Close via t.Cleanup, registered BEFORE any per-test cleanup, so it runs
	// LAST (LIFO). The previous `defer p.Close()` pattern at call sites closed
	// the pool before t.Cleanup-registered DELETEs ran, so every signing_key
	// cleanup silently failed and the shared dev DB accumulated hundreds of
	// orphaned test keys — the pollution behind the platform-wide 401.
	t.Cleanup(p.Close)
	return p
}

func TestLoadOrCreateCreatesAndReloads(t *testing.T) {
	p := newPool(t)
	kid := "test-kid-" + randStr(8)
	defer p.Exec(context.Background(), "DELETE FROM signing_key WHERE kid=$1", kid)

	kp1, err := LoadOrCreate(context.Background(), p, kid)
	if err != nil {
		t.Fatal(err)
	}
	kp2, err := LoadOrCreate(context.Background(), p, kid)
	if err != nil {
		t.Fatal(err)
	}

	// Public moduli must match → same key reloaded, not regenerated
	pub1, _ := kp1.JWKS()
	pub2, _ := kp2.JWKS()
	k1, _ := pub1.Key(0)
	k2, _ := pub2.Key(0)

	n1, ok1 := k1.Get("n")
	n2, ok2 := k2.Get("n")
	if !ok1 || !ok2 {
		t.Fatalf("could not get n field: ok1=%v ok2=%v", ok1, ok2)
	}
	// n values are []byte (big.Int bytes), compare via string representation
	n1s := toString(n1)
	n2s := toString(n2)
	if n1s == "" || n1s != n2s {
		t.Fatalf("key not persisted: n1=%q n2=%q", n1s, n2s)
	}
}

// TestLoadOrCreateIdempotentAfterRotation reproduces the boot crash: a kid is
// created, then rotation supersedes it (active=false). Booting again with the
// SAME configured kid must NOT attempt a duplicate INSERT (which violated the
// signing_key primary key and made identity-svc unbootable). Instead the
// existing row is reloaded, and because no other key is active here it gets
// re-activated so the signer has a usable active key.
func TestLoadOrCreateIdempotentAfterRotation(t *testing.T) {
	p := rotatePool(t)
	lockSigningKeys(t, p)
	// Rotate demotes every active row table-wide; snapshot + restore so the
	// live identity-svc's key isn't left demoted in the shared dev DB.
	deactivateAllActives(t, p)
	ctx := context.Background()

	suffix := uniqSuffix(t)
	oldKid := "boot-old-" + suffix
	newKid := "boot-new-" + suffix
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(),
			"DELETE FROM signing_key WHERE kid IN ($1,$2)", oldKid, newKid)
	})

	// Boot once: creates oldKid (active).
	kp1, err := LoadOrCreate(ctx, p, oldKid)
	if err != nil {
		t.Fatalf("initial LoadOrCreate: %v", err)
	}

	// Rotate to newKid: oldKid becomes active=false, newKid becomes active.
	s := NewStore(p, 0)
	if _, err := s.Rotate(ctx, newKid); err != nil {
		t.Fatalf("rotate: %v", err)
	}

	// Re-boot with the SAME old kid. Before the fix this crashed with
	// duplicate key value violates unique constraint "signing_key_pkey".
	kp2, err := LoadOrCreate(ctx, p, oldKid)
	if err != nil {
		t.Fatalf("re-boot LoadOrCreate after rotation must not error: %v", err)
	}

	// Must be the SAME key reloaded, not a regenerated one.
	if !sameModulus(t, kp1, kp2) {
		t.Fatal("re-loaded key differs from original; row was not reused")
	}

	// Exactly one row for oldKid must exist (no duplicate insert).
	var cnt int
	if err := p.QueryRow(ctx,
		"SELECT count(*) FROM signing_key WHERE kid=$1", oldKid).Scan(&cnt); err != nil {
		t.Fatalf("count: %v", err)
	}
	if cnt != 1 {
		t.Fatalf("expected exactly 1 row for %q, got %d", oldKid, cnt)
	}

	// newKid is still active (healthy rotation untouched), so re-booting with
	// the old kid must NOT have stolen the active flag.
	var oldActive bool
	if err := p.QueryRow(ctx,
		"SELECT active FROM signing_key WHERE kid=$1", oldKid).Scan(&oldActive); err != nil {
		t.Fatalf("read old active: %v", err)
	}
	if oldActive {
		t.Fatal("old kid was re-activated even though another key was active")
	}

	// A signer fed by the store must still have a usable active key.
	if err := s.Refresh(ctx); err != nil {
		t.Fatalf("Refresh after re-boot: %v", err)
	}
	if _, kid := s.CurrentKey(); kid != newKid {
		t.Fatalf("active signer kid = %q, want %q", kid, newKid)
	}
}

// TestLoadOrCreateReactivatesWhenNoneActive covers the boot case where the
// configured kid exists but is inactive AND nothing else is active (e.g. a
// manual DB state or a half-rotation). LoadOrCreate must re-activate it so the
// signer is not left without an active key to mint with.
func TestLoadOrCreateReactivatesWhenNoneActive(t *testing.T) {
	p := rotatePool(t)
	lockSigningKeys(t, p)
	ctx := context.Background()

	suffix := uniqSuffix(t)
	kid := "boot-reactivate-" + suffix
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), "DELETE FROM signing_key WHERE kid=$1", kid)
	})

	if _, err := LoadOrCreate(ctx, p, kid); err != nil {
		t.Fatalf("create: %v", err)
	}

	// The "no active key" branch is a global condition (the signer picks the
	// newest active row table-wide). To exercise it deterministically in a
	// shared dev DB, snapshot any currently-active kids, deactivate them for
	// the duration of this test, then restore on cleanup.
	otherActive := snapshotActiveKids(t, p, kid)
	if _, err := p.Exec(ctx,
		"UPDATE signing_key SET active=false WHERE active"); err != nil {
		t.Fatalf("deactivate all: %v", err)
	}
	t.Cleanup(func() {
		for _, k := range otherActive {
			_, _ = p.Exec(context.Background(),
				"UPDATE signing_key SET active=true WHERE kid=$1", k)
		}
	})

	if _, err := LoadOrCreate(ctx, p, kid); err != nil {
		t.Fatalf("re-boot must not error: %v", err)
	}

	var active bool
	if err := p.QueryRow(ctx,
		"SELECT active FROM signing_key WHERE kid=$1", kid).Scan(&active); err != nil {
		t.Fatalf("read active: %v", err)
	}
	if !active {
		t.Fatal("kid should have been re-activated when no other key was active")
	}
}

// snapshotActiveKids returns the kids of all currently-active rows except the
// excluded one, so a test can deactivate them and restore them afterward
// without disturbing other concurrent state in the shared dev DB.
func snapshotActiveKids(t *testing.T, p *pgxpool.Pool, exclude string) []string {
	t.Helper()
	rows, err := p.Query(context.Background(),
		"SELECT kid FROM signing_key WHERE active AND kid <> $1", exclude)
	if err != nil {
		t.Fatalf("snapshot active: %v", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			t.Fatalf("scan kid: %v", err)
		}
		out = append(out, k)
	}
	return out
}

func sameModulus(t *testing.T, a, b *KeyPair) bool {
	t.Helper()
	pa, _ := a.JWKS()
	pb, _ := b.JWKS()
	ka, _ := pa.Key(0)
	kb, _ := pb.Key(0)
	na, _ := ka.Get("n")
	nb, _ := kb.Get("n")
	return toString(na) != "" && toString(na) == toString(nb)
}

func toString(v interface{}) string {
	switch val := v.(type) {
	case []byte:
		return string(val)
	case string:
		return val
	default:
		return ""
	}
}

func randStr(n int) string {
	const a = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = a[(i*7+17)%len(a)]
	}
	return string(b)
}
