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

	"github.com/pmplatform/services/identity-svc/internal/domain"
	"github.com/pmplatform/services/identity-svc/internal/jwt"
	"github.com/pmplatform/services/identity-svc/internal/service"
	"github.com/pmplatform/services/identity-svc/internal/store"
)

// refreshSetup wires the full Login + Refresh flow against real PG. Mirrors
// setup() in handlers_test.go but mounts /v1/auth/refresh and attaches the
// new refresh_token store to Auth so Login produces a rotation-capable row.
func refreshSetup(t *testing.T) (http.Handler, *pgxpool.Pool, uuid.UUID, string, func()) {
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
	if _, err := p.Exec(ctx,
		`INSERT INTO tenant(id, slug, name) VALUES ($1,'rt-'||substr(md5(random()::text),1,6),'R')`, tid); err != nil {
		p.Close()
		t.Fatal(err)
	}

	pw, _ := domain.HashPassword("VeryStrong#1")
	uid := uuid.New()
	email := "refresh-" + uuid.NewString()[:6] + "@test.com"
	tx, _ := p.Begin(ctx)
	_, _ = tx.Exec(ctx, "SET LOCAL app.current_tenant = '"+tid.String()+"'")
	if _, err := tx.Exec(ctx,
		`INSERT INTO app_user(id, tenant_id, email, display_name, status, password_hash, version)
         VALUES ($1,$2,$3,'R','active',$4,1)`, uid, tid, email, pw); err != nil {
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
	auth := service.NewAuth(users, store.NewSessions(p), signer, pub).
		WithRefreshTokens(tokens, 30*24*time.Hour)
	refresh := service.NewRefresh(users, tokens, signer, pub)

	h := NewRouterWithRefresh(auth, refresh, kp, nil, "", nil, nil, nil)
	cleanup := func() {
		p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tid)
		p.Close()
	}
	return h, p, tid, email, cleanup
}

func doLogin(t *testing.T, h http.Handler, tid uuid.UUID, email string) service.TokenPair {
	t.Helper()
	body, _ := json.Marshal(map[string]string{
		"tenant_id": tid.String(), "email": email, "password": "VeryStrong#1",
	})
	req := httptest.NewRequest("POST", "/v1/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("login: got %d: %s", rec.Code, rec.Body.String())
	}
	var tp service.TokenPair
	_ = json.Unmarshal(rec.Body.Bytes(), &tp)
	if tp.RefreshToken == "" {
		t.Fatal("login: no refresh token")
	}
	return tp
}

func postRefresh(h http.Handler, token string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(map[string]string{"refresh_token": token})
	req := httptest.NewRequest("POST", "/v1/auth/refresh", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRefreshHappyPath(t *testing.T) {
	h, p, tid, email, cleanup := refreshSetup(t)
	defer cleanup()

	tp1 := doLogin(t, h, tid, email)
	rec := postRefresh(h, tp1.RefreshToken)
	if rec.Code != 200 {
		t.Fatalf("refresh: got %d: %s", rec.Code, rec.Body.String())
	}
	var tp2 service.TokenPair
	_ = json.Unmarshal(rec.Body.Bytes(), &tp2)
	if tp2.AccessToken == "" || tp2.RefreshToken == "" {
		t.Fatalf("missing tokens in response: %+v", tp2)
	}
	if tp2.RefreshToken == tp1.RefreshToken {
		t.Fatal("rotated refresh token must differ from presented one")
	}

	// The presented row must now be revoked, and the new row must share
	// family_id and point at the old row via parent_id.
	old := sha256.Sum256(mustHex(t, tp1.RefreshToken))
	new_ := sha256.Sum256(mustHex(t, tp2.RefreshToken))

	var oldRevoked *time.Time
	var oldFamily uuid.UUID
	if err := p.QueryRow(context.Background(),
		`SELECT revoked_at, family_id FROM refresh_token WHERE token_hash=$1`,
		old[:]).Scan(&oldRevoked, &oldFamily); err != nil {
		t.Fatal(err)
	}
	if oldRevoked == nil {
		t.Fatal("expected old refresh token to be revoked")
	}

	var newFamily uuid.UUID
	var newParent *uuid.UUID
	if err := p.QueryRow(context.Background(),
		`SELECT family_id, parent_id FROM refresh_token WHERE token_hash=$1`,
		new_[:]).Scan(&newFamily, &newParent); err != nil {
		t.Fatal(err)
	}
	if newFamily != oldFamily {
		t.Fatalf("family_id should be inherited: old=%s new=%s", oldFamily, newFamily)
	}
	if newParent == nil {
		t.Fatal("new row parent_id should reference the old row")
	}
}

func TestRefreshReuseDetectionRevokesFamily(t *testing.T) {
	h, p, tid, email, cleanup := refreshSetup(t)
	defer cleanup()

	tp1 := doLogin(t, h, tid, email)

	// First refresh succeeds.
	rec := postRefresh(h, tp1.RefreshToken)
	if rec.Code != 200 {
		t.Fatalf("first refresh: got %d: %s", rec.Code, rec.Body.String())
	}
	var tp2 service.TokenPair
	_ = json.Unmarshal(rec.Body.Bytes(), &tp2)

	// Second presentation of the ORIGINAL (now-revoked) token must trip
	// reuse detection and return 401.
	rec = postRefresh(h, tp1.RefreshToken)
	if rec.Code != 401 {
		t.Fatalf("expected 401 on reuse, got %d: %s", rec.Code, rec.Body.String())
	}

	// The previously-valid descendant (tp2) must now also be revoked because
	// the whole family was nuked.
	new_ := sha256.Sum256(mustHex(t, tp2.RefreshToken))
	var revoked *time.Time
	if err := p.QueryRow(context.Background(),
		`SELECT revoked_at FROM refresh_token WHERE token_hash=$1`,
		new_[:]).Scan(&revoked); err != nil {
		t.Fatal(err)
	}
	if revoked == nil {
		t.Fatal("descendant token must be revoked after family-wide revocation")
	}

	// And presenting the descendant after family revocation must also 401.
	rec = postRefresh(h, tp2.RefreshToken)
	if rec.Code != 401 {
		t.Fatalf("expected 401 on family-revoked descendant, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestRefreshExpiredToken(t *testing.T) {
	h, p, tid, email, cleanup := refreshSetup(t)
	defer cleanup()

	tp1 := doLogin(t, h, tid, email)

	// Backdate the expires_at directly. RLS requires app.current_tenant for
	// UPDATE to match a row, so wrap in a tx that sets it.
	ctx := context.Background()
	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, "SET LOCAL app.current_tenant = '"+tid.String()+"'"); err != nil {
		tx.Rollback(ctx)
		t.Fatal(err)
	}
	hash := sha256.Sum256(mustHex(t, tp1.RefreshToken))
	if _, err := tx.Exec(ctx,
		`UPDATE refresh_token SET expires_at = now() - interval '1 hour' WHERE token_hash = $1`,
		hash[:]); err != nil {
		tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	rec := postRefresh(h, tp1.RefreshToken)
	if rec.Code != 401 {
		t.Fatalf("expected 401 on expired token, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestRefreshUnknownToken(t *testing.T) {
	h, _, _, _, cleanup := refreshSetup(t)
	defer cleanup()

	// Well-formed (64 hex chars) but never issued.
	bogus := hex.EncodeToString(bytes.Repeat([]byte{0xab}, 32))
	rec := postRefresh(h, bogus)
	if rec.Code != 401 {
		t.Fatalf("expected 401 on unknown token, got %d: %s", rec.Code, rec.Body.String())
	}
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("decode hex: %v", err)
	}
	return b
}
