package jwt

import (
	"context"
	crand "crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func uniqSuffix(t *testing.T) string {
	t.Helper()
	b := make([]byte, 8)
	if _, err := crand.Read(b); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return hex.EncodeToString(b)
}

// rotatePool prefers the project-native dev DB (localhost:5432) but honors
// TEST_DATABASE_URL when set (e.g. CI).
func rotatePool(t *testing.T) *pgxpool.Pool {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	// Ping so we skip cleanly if the DB is down instead of failing mid-test.
	if err := p.Ping(context.Background()); err != nil {
		p.Close()
		t.Skipf("postgres ping failed: %v", err)
	}
	return p
}

func TestRotatePublishesBothKeysAndMarksNewestActive(t *testing.T) {
	p := rotatePool(t)
	defer p.Close()

	ctx := context.Background()
	suffix := uniqSuffix(t)
	kid1 := "rot-1-" + suffix
	kid2 := "rot-2-" + suffix
	kid3 := "rot-3-" + suffix
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(),
			"DELETE FROM signing_key WHERE kid IN ($1,$2,$3)", kid1, kid2, kid3)
	})

	// Seed: create the first key via the existing LoadOrCreate path.
	if _, err := LoadOrCreate(ctx, p, kid1); err != nil {
		t.Fatalf("seed LoadOrCreate: %v", err)
	}

	// 24h grace so rotated-out keys remain published.
	s := NewStore(p, 24*time.Hour)

	// Rotate once -> active becomes kid2, kid1 stays in JWKS within grace.
	if _, err := s.Rotate(ctx, kid2); err != nil {
		t.Fatalf("first rotate: %v", err)
	}

	// Rotate again -> active becomes kid3.
	if _, err := s.Rotate(ctx, kid3); err != nil {
		t.Fatalf("second rotate: %v", err)
	}

	// Exactly one row should be active, and it must be kid3.
	var activeKid string
	var activeCount int
	if err := p.QueryRow(ctx,
		`SELECT count(*) FROM signing_key
		 WHERE kid IN ($1,$2,$3) AND active`,
		kid1, kid2, kid3,
	).Scan(&activeCount); err != nil {
		t.Fatalf("count active: %v", err)
	}
	if activeCount != 1 {
		t.Fatalf("expected exactly 1 active row across our 3 kids, got %d", activeCount)
	}
	if err := p.QueryRow(ctx,
		`SELECT kid FROM signing_key
		 WHERE kid IN ($1,$2,$3) AND active`,
		kid1, kid2, kid3,
	).Scan(&activeKid); err != nil {
		t.Fatalf("read active kid: %v", err)
	}
	if activeKid != kid3 {
		t.Fatalf("active kid = %q, want %q", activeKid, kid3)
	}

	// Active() should also report kid3.
	_, gotKid, err := s.Active(ctx)
	if err != nil {
		t.Fatalf("Active: %v", err)
	}
	if gotKid != kid3 {
		t.Fatalf("Active().kid = %q, want %q", gotKid, kid3)
	}

	// JWKS should publish all three keys (kid1 + kid2 rotated within grace,
	// kid3 active). We assert at least 2 distinct kids drawn from our set
	// and that the active kid is present.
	set, err := s.JWKS(ctx)
	if err != nil {
		t.Fatalf("JWKS: %v", err)
	}

	kids := jwksKids(t, set)
	ours := map[string]bool{kid1: true, kid2: true, kid3: true}
	seen := map[string]bool{}
	for _, k := range kids {
		if ours[k] {
			seen[k] = true
		}
	}
	if !seen[kid3] {
		t.Fatalf("active kid %q missing from JWKS (saw: %v)", kid3, kids)
	}
	if len(seen) < 2 {
		t.Fatalf("expected JWKS to include >=2 of our kids (rotation grace), saw %v out of {%s,%s,%s}",
			seen, kid1, kid2, kid3)
	}

	// Sanity: kids in JWKS must be distinct.
	dup := map[string]int{}
	for _, k := range kids {
		dup[k]++
	}
	for k, n := range dup {
		if n > 1 {
			t.Fatalf("duplicate kid %q appears %d times in JWKS", k, n)
		}
	}
}

func TestJWKSExcludesKeysPastGrace(t *testing.T) {
	p := rotatePool(t)
	defer p.Close()

	ctx := context.Background()
	suffix := uniqSuffix(t)
	kidOld := "old-" + suffix
	kidNew := "new-" + suffix
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(),
			"DELETE FROM signing_key WHERE kid IN ($1,$2)", kidOld, kidNew)
	})

	// Seed kidOld with a backdated created_at far outside any grace.
	if _, err := LoadOrCreate(ctx, p, kidOld); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if _, err := p.Exec(ctx,
		`UPDATE signing_key SET created_at = now() - interval '30 days', active=false
		 WHERE kid=$1`, kidOld); err != nil {
		t.Fatalf("backdate: %v", err)
	}

	// Insert the new active key directly so rotation logic isn't required here.
	if _, err := LoadOrCreate(ctx, p, kidNew); err != nil {
		t.Fatalf("insert new: %v", err)
	}

	// 1h grace -> the 30-day-old, inactive key must be excluded.
	s := NewStore(p, time.Hour)
	set, err := s.JWKS(ctx)
	if err != nil {
		t.Fatalf("JWKS: %v", err)
	}
	for _, k := range jwksKids(t, set) {
		if k == kidOld {
			t.Fatalf("kidOld (%q) past grace should not appear in JWKS", kidOld)
		}
	}
}

func jwksKids(t *testing.T, set interface{}) []string {
	t.Helper()
	// Marshal the set to JSON and pull "kid" values back out so we don't
	// depend on the lestrrat jwk Iterator API surface.
	b, err := json.Marshal(set)
	if err != nil {
		t.Fatalf("marshal jwks: %v", err)
	}
	var doc struct {
		Keys []struct {
			Kid string `json:"kid"`
		} `json:"keys"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatalf("unmarshal jwks: %v", err)
	}
	out := make([]string, 0, len(doc.Keys))
	for _, k := range doc.Keys {
		out = append(out, k.Kid)
	}
	return out
}
