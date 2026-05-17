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
		dsn = "postgres://app:app@localhost:5433/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	return p
}

func TestLoadOrCreateCreatesAndReloads(t *testing.T) {
	p := newPool(t)
	defer p.Close()
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
