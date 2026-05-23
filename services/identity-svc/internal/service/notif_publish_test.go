package service

import (
	"context"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/libs/go/audit"
	notiflib "github.com/pmplatform/libs/go/notification"

	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/identity-svc/internal/domain"
	idxjwt "github.com/pmplatform/services/identity-svc/internal/jwt"
	"github.com/pmplatform/services/identity-svc/internal/store"
)

// TestAuth_Login_PublishesNotifEvent asserts that a successful Login call
// publishes a "user.login" notification event to the injected publisher.
func TestAuth_Login_PublishesNotifEvent(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skip("postgres unavailable:", err)
	}
	defer p.Close()

	ctx := context.Background()

	// Seed tenant + user.
	tid := uuid.New()
	if _, err := p.Exec(ctx,
		`INSERT INTO tenant(id, slug, name) VALUES ($1, 'notif-'||substr(md5(random()::text),1,6), 'NotifTest')`, tid,
	); err != nil {
		t.Fatal("seed tenant:", err)
	}
	t.Cleanup(func() {
		p.Exec(ctx, "DELETE FROM tenant WHERE id=$1", tid)
	})

	pw, _ := domain.HashPassword("VeryStrong#1")
	uid := uuid.New()
	email := "notif-" + uuid.NewString()[:6] + "@test.com"

	tx, _ := p.Begin(ctx)
	_, _ = tx.Exec(ctx, "SET LOCAL app.current_tenant = '"+tid.String()+"'")
	_, err = tx.Exec(ctx,
		`INSERT INTO app_user(id, tenant_id, email, display_name, status, password_hash, version)
         VALUES ($1,$2,$3,'NTest','active',$4,1)`, uid, tid, email, pw)
	if err != nil {
		tx.Rollback(ctx)
		t.Fatal("seed user:", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal("commit:", err)
	}

	// Wire service with a fake notif publisher.
	kp, err := idxjwt.GenerateKeyPair("kid-test")
	if err != nil {
		t.Fatal("key gen:", err)
	}
	signer := libauth.NewSigner(kp.Priv, "test")
	aud := audit.NewPgPublisher(p, "test")
	pub := &fakeNotifPublisher{}

	authSvc := NewAuth(store.NewUsers(p), store.NewSessions(p), signer, aud, pub)

	_, err = authSvc.Login(ctx, LoginInput{
		TenantID: tid,
		Email:    email,
		Password: "VeryStrong#1",
	})
	if err != nil {
		t.Fatalf("Login failed: %v", err)
	}

	if len(pub.events) != 1 {
		t.Fatalf("expected 1 notif event, got %d", len(pub.events))
	}
	ev := pub.events[0]
	if ev.Kind != "user.login" {
		t.Errorf("Kind: got %q, want %q", ev.Kind, "user.login")
	}
	if ev.TenantID != tid.String() {
		t.Errorf("TenantID: got %q, want %q", ev.TenantID, tid.String())
	}
	if ev.UserID != uid.String() {
		t.Errorf("UserID: got %q, want %q", ev.UserID, uid.String())
	}

	_ = notiflib.NoopPublisher{} // compile-time interface satisfaction
}
