package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	libauth "github.com/pmplatform/libs/go/auth"
	"github.com/pmplatform/libs/go/audit"
	notiflib "github.com/pmplatform/libs/go/notification"

	"github.com/pmplatform/services/identity-svc/internal/domain"
	"github.com/pmplatform/services/identity-svc/internal/jwt"
	"github.com/pmplatform/services/identity-svc/internal/service"
	"github.com/pmplatform/services/identity-svc/internal/store"
)

// captureMailer records the most recent message so tests can read the
// freshly-issued reset token out of the body.
type captureMailer struct {
	to, subject, body string
	count             int
}

func (m *captureMailer) Send(_ context.Context, to, subject, body string) error {
	m.to = to
	m.subject = subject
	m.body = body
	m.count++
	return nil
}

func resetSetup(t *testing.T) (http.Handler, *pgxpool.Pool, uuid.UUID, string, string, *captureMailer, func()) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skip(err)
	}

	ctx := context.Background()
	tid := uuid.New()
	slug := "pr-" + uuid.NewString()[:6]
	if _, err := p.Exec(ctx,
		`INSERT INTO tenant(id, slug, name) VALUES ($1,$2,'PR')`, tid, slug); err != nil {
		p.Close()
		t.Fatal(err)
	}

	pw, _ := domain.HashPassword("VeryStrong#1")
	uid := uuid.New()
	email := "reset-" + uuid.NewString()[:6] + "@test.com"
	tx, _ := p.Begin(ctx)
	_, _ = tx.Exec(ctx, "SET LOCAL app.current_tenant = '"+tid.String()+"'")
	if _, err := tx.Exec(ctx,
		`INSERT INTO app_user(id, tenant_id, email, display_name, status, password_hash, version)
         VALUES ($1,$2,$3,'PR','active',$4,1)`, uid, tid, email, pw); err != nil {
		tx.Rollback(ctx)
		p.Close()
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		p.Close()
		t.Fatal(err)
	}

	kp, _ := jwt.GenerateKeyPair("kid-test")
	signer := libauth.NewSigner(kp.Priv, "test")
	pub := audit.NewPgPublisher(p, "test")

	users := store.NewUsers(p)
	tokens := store.NewRefreshTokens(p)
	resets := store.NewPasswordResets(p)
	auth := service.NewAuth(users, store.NewSessions(p), signer, pub, notiflib.NoopPublisher{}).
		WithRefreshTokens(tokens, 30*24*time.Hour)
	refresh := service.NewRefresh(users, tokens, signer, pub)
	mailer := &captureMailer{}
	passwordReset := service.NewPasswordReset(users, tokens, resets, mailer, pub, time.Hour,
		"http://example/reset?token=", notiflib.NoopPublisher{})

	h := NewRouterWithRefreshAndReset(auth, refresh, passwordReset, kp, nil, "", nil, nil, nil)
	cleanup := func() {
		p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tid)
		p.Close()
	}
	return h, p, tid, slug, email, mailer, cleanup
}

func postRequestReset(h http.Handler, slug, email string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(map[string]string{"tenant_slug": slug, "email": email})
	req := httptest.NewRequest("POST", "/v1/auth/password/request-reset", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func postConsumeReset(h http.Handler, token, newPass string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(map[string]string{"token": token, "new_password": newPass})
	req := httptest.NewRequest("POST", "/v1/auth/password/reset", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// extractTokenFromBody pulls the last whitespace-free hex64 token off the
// mailer body. The body has the format "...<base-url>?token=<HEX>\n...".
func extractTokenFromBody(t *testing.T, body string) string {
	t.Helper()
	idx := -1
	for i := len(body) - 1; i >= 64; i-- {
		ok := true
		for j := 0; j < 64; j++ {
			c := body[i-63+j]
			if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
				ok = false
				break
			}
		}
		if ok {
			idx = i - 63
			break
		}
	}
	if idx < 0 {
		t.Fatalf("no hex64 token found in body: %s", body)
	}
	return body[idx : idx+64]
}

func TestPasswordResetHappyPath(t *testing.T) {
	h, p, tid, slug, email, mailer, cleanup := resetSetup(t)
	defer cleanup()

	rec := postRequestReset(h, slug, email)
	if rec.Code != 200 {
		t.Fatalf("request-reset: got %d: %s", rec.Code, rec.Body.String())
	}
	if mailer.count != 1 {
		t.Fatalf("expected mailer to fire once, got %d", mailer.count)
	}
	if mailer.to != email {
		t.Fatalf("mailer to mismatch: %s != %s", mailer.to, email)
	}
	tok := extractTokenFromBody(t, mailer.body)
	t.Logf("captured reset token from mailer body (first 16): %s...", tok[:16])

	rec = postConsumeReset(h, tok, "NewStrong#1234")
	if rec.Code != 200 {
		t.Fatalf("reset: got %d: %s", rec.Code, rec.Body.String())
	}

	// New password should authenticate; old should not.
	var hash string
	if err := p.QueryRow(context.Background(),
		"SELECT password_hash FROM app_user WHERE tenant_id=$1 AND email=$2", tid, email).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if err := domain.CheckPassword(hash, "NewStrong#1234"); err != nil {
		t.Fatalf("new password should validate: %v", err)
	}
	if err := domain.CheckPassword(hash, "VeryStrong#1"); err == nil {
		t.Fatal("old password should no longer validate")
	}

	// Token must be marked consumed.
	hashBytes := sha256.Sum256(mustHex(t, tok))
	var consumed *time.Time
	if err := p.QueryRow(context.Background(),
		"SELECT consumed_at FROM password_reset_token WHERE token_hash=$1", hashBytes[:]).Scan(&consumed); err != nil {
		t.Fatal(err)
	}
	if consumed == nil {
		t.Fatal("expected consumed_at to be set after reset")
	}
}

func TestPasswordResetUnknownEmailReturns200(t *testing.T) {
	h, _, _, slug, _, mailer, cleanup := resetSetup(t)
	defer cleanup()

	rec := postRequestReset(h, slug, "nobody-"+uuid.NewString()[:6]+"@test.com")
	if rec.Code != 200 {
		t.Fatalf("expected 200 for unknown email (anti-enum), got %d: %s", rec.Code, rec.Body.String())
	}
	if mailer.count != 0 {
		t.Fatalf("mailer must not fire for unknown email, got count=%d", mailer.count)
	}

	rec = postRequestReset(h, "no-such-tenant", "x@test.com")
	if rec.Code != 200 {
		t.Fatalf("expected 200 for unknown tenant slug (anti-enum), got %d", rec.Code)
	}
	if mailer.count != 0 {
		t.Fatalf("mailer must not fire for unknown tenant, got count=%d", mailer.count)
	}
}

func TestPasswordResetExpiredToken(t *testing.T) {
	h, p, tid, slug, email, mailer, cleanup := resetSetup(t)
	defer cleanup()

	rec := postRequestReset(h, slug, email)
	if rec.Code != 200 {
		t.Fatalf("request-reset: got %d", rec.Code)
	}
	tok := extractTokenFromBody(t, mailer.body)

	// Backdate the row's expires_at past now.
	ctx := context.Background()
	tx, _ := p.Begin(ctx)
	_, _ = tx.Exec(ctx, "SET LOCAL app.current_tenant = '"+tid.String()+"'")
	hashBytes := sha256.Sum256(mustHex(t, tok))
	if _, err := tx.Exec(ctx,
		`UPDATE password_reset_token SET expires_at = now() - interval '5 minute' WHERE token_hash=$1`,
		hashBytes[:]); err != nil {
		tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	rec = postConsumeReset(h, tok, "NewStrong#1234")
	if rec.Code != 400 {
		t.Fatalf("expected 400 on expired token, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPasswordResetReusedTokenRejected(t *testing.T) {
	h, _, _, slug, email, mailer, cleanup := resetSetup(t)
	defer cleanup()

	rec := postRequestReset(h, slug, email)
	if rec.Code != 200 {
		t.Fatalf("request-reset: got %d", rec.Code)
	}
	tok := extractTokenFromBody(t, mailer.body)

	rec = postConsumeReset(h, tok, "NewStrong#1234")
	if rec.Code != 200 {
		t.Fatalf("first reset should succeed: got %d: %s", rec.Code, rec.Body.String())
	}

	// Replay the same token — must 400.
	rec = postConsumeReset(h, tok, "EvenNewer#5678")
	if rec.Code != 400 {
		t.Fatalf("expected 400 on reused token, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPasswordResetRevokesLiveRefreshTokens(t *testing.T) {
	h, p, tid, slug, email, mailer, cleanup := resetSetup(t)
	defer cleanup()

	// Step 1: log in twice so the user has TWO live refresh tokens.
	tp1 := doLogin(t, h, tid, email)
	tp2 := doLogin(t, h, tid, email)

	// Sanity: both rows live.
	hash1 := sha256.Sum256(mustHex(t, tp1.RefreshToken))
	hash2 := sha256.Sum256(mustHex(t, tp2.RefreshToken))
	var rev1, rev2 *time.Time
	_ = p.QueryRow(context.Background(),
		"SELECT revoked_at FROM refresh_token WHERE token_hash=$1", hash1[:]).Scan(&rev1)
	_ = p.QueryRow(context.Background(),
		"SELECT revoked_at FROM refresh_token WHERE token_hash=$1", hash2[:]).Scan(&rev2)
	if rev1 != nil || rev2 != nil {
		t.Fatalf("preconditions: both refresh rows should be live (rev1=%v rev2=%v)", rev1, rev2)
	}

	// Step 2: full reset flow.
	if rec := postRequestReset(h, slug, email); rec.Code != 200 {
		t.Fatalf("request-reset: got %d", rec.Code)
	}
	tok := extractTokenFromBody(t, mailer.body)
	if rec := postConsumeReset(h, tok, "NewStrong#1234"); rec.Code != 200 {
		t.Fatalf("consume-reset: got %d: %s", rec.Code, rec.Body.String())
	}

	// Step 3: every live refresh row for the user must now be revoked.
	if err := p.QueryRow(context.Background(),
		"SELECT revoked_at FROM refresh_token WHERE token_hash=$1", hash1[:]).Scan(&rev1); err != nil {
		t.Fatal(err)
	}
	if err := p.QueryRow(context.Background(),
		"SELECT revoked_at FROM refresh_token WHERE token_hash=$1", hash2[:]).Scan(&rev2); err != nil {
		t.Fatal(err)
	}
	if rev1 == nil || rev2 == nil {
		t.Fatalf("expected both refresh tokens revoked after password reset; rev1=%v rev2=%v", rev1, rev2)
	}

	// And presenting the (now-revoked) token to /refresh must 401.
	body, _ := json.Marshal(map[string]string{"refresh_token": tp1.RefreshToken})
	req := httptest.NewRequest("POST", "/v1/auth/refresh", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("expected 401 on refresh after password reset, got %d: %s", rec.Code, rec.Body.String())
	}
}

// Silence unused-import warnings when only some tests are run.
var _ = hex.EncodeToString
