package main

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/identity-svc/internal/jwt"
)

func schedulerTestPool(t *testing.T) *pgxpool.Pool {
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

// TestRotationSchedulerRotatesOnTick uses an extremely short tick interval
// instead of mocking time. The scheduler must fire at least twice within
// a small wall-clock window, advancing the active kid each time.
func TestRotationSchedulerRotatesOnTick(t *testing.T) {
	p := schedulerTestPool(t)
	lockSigningKeys(t, p)
	restoreActivesAfter(t, p)

	ctx := context.Background()
	bootKid := "sched-boot-" + time.Now().Format("150405.000000")
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(),
			"DELETE FROM signing_key WHERE kid LIKE 'sched-boot-%' OR kid LIKE 'auto-%'")
	})
	kp, err := jwt.LoadOrCreate(ctx, p, bootKid)
	if err != nil {
		t.Fatal(err)
	}
	ks := jwt.NewStore(p, 24*time.Hour)
	ks.Bind(kp, bootKid)

	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	// 50ms tick → at least two rotations in 200ms.
	go runRotationScheduler(runCtx, ks, 50*time.Millisecond)

	deadline := time.Now().Add(2 * time.Second)
	var rotations int
	last := bootKid
	for time.Now().Before(deadline) {
		_, kid := ks.CurrentKey()
		if kid != last {
			rotations++
			last = kid
			if rotations >= 2 {
				break
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	cancel()

	if rotations < 2 {
		t.Fatalf("expected >=2 rotations from scheduler, got %d (last kid=%q)", rotations, last)
	}
}

// TestRotationSchedulerHonorsCancel verifies the goroutine returns promptly
// when its context is canceled, so SIGTERM doesn't strand it.
func TestRotationSchedulerHonorsCancel(t *testing.T) {
	p := schedulerTestPool(t)
	lockSigningKeys(t, p)
	restoreActivesAfter(t, p)
	ctx := context.Background()
	bootKid := "sched-cancel-" + time.Now().Format("150405.000000")
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(),
			"DELETE FROM signing_key WHERE kid LIKE 'sched-cancel-%' OR kid LIKE 'auto-%'")
	})
	kp, err := jwt.LoadOrCreate(ctx, p, bootKid)
	if err != nil {
		t.Fatal(err)
	}
	ks := jwt.NewStore(p, 24*time.Hour)
	ks.Bind(kp, bootKid)

	runCtx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		runRotationScheduler(runCtx, ks, time.Hour) // very long
		close(done)
	}()

	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("scheduler did not return within 2s of cancel")
	}
}
