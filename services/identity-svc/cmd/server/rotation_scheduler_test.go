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
	return p
}

// TestRotationSchedulerRotatesOnTick uses an extremely short tick interval
// instead of mocking time. The scheduler must fire at least twice within
// a small wall-clock window, advancing the active kid each time.
func TestRotationSchedulerRotatesOnTick(t *testing.T) {
	p := schedulerTestPool(t)
	defer p.Close()

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
	defer p.Close()
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
