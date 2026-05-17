package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/identity-svc/internal/domain"
	"github.com/pmplatform/services/identity-svc/internal/jwt"
	"github.com/pmplatform/services/identity-svc/internal/service"
	"github.com/pmplatform/services/identity-svc/internal/store"
)

func setup(t *testing.T) (http.Handler, *pgxpool.Pool, uuid.UUID, func()) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5433/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skip(err)
	}

	ctx := context.Background()
	tid := uuid.New()
	_, err = p.Exec(ctx,
		`INSERT INTO tenant(id, slug, name) VALUES ($1,'lg-'||substr(md5(random()::text),1,6),'L')`, tid)
	if err != nil {
		p.Close()
		t.Fatal(err)
	}

	pw, _ := domain.HashPassword("VeryStrong#1")
	uid := uuid.New()
	email := "login-" + uuid.NewString()[:6] + "@test.com"
	tx, _ := p.Begin(ctx)
	_, _ = tx.Exec(ctx, "SET LOCAL app.current_tenant = '"+tid.String()+"'")
	_, err = tx.Exec(ctx,
		`INSERT INTO app_user(id, tenant_id, email, display_name, status, password_hash, version)
         VALUES ($1,$2,$3,'L','active',$4,1)`, uid, tid, email, pw)
	if err != nil {
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
	auth := service.NewAuth(store.NewUsers(p), store.NewSessions(p), signer)

	h := NewRouter(auth, kp)
	cleanup := func() {
		p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tid)
		p.Close()
	}
	return h, p, tid, cleanup
}

func TestLoginHappyPath(t *testing.T) {
	h, p, tid, cleanup := setup(t)
	defer cleanup()

	var email string
	_ = p.QueryRow(context.Background(),
		"SELECT email FROM app_user WHERE tenant_id=$1 LIMIT 1", tid).Scan(&email)

	body, _ := json.Marshal(map[string]string{
		"tenant_id": tid.String(), "email": email, "password": "VeryStrong#1",
	})
	req := httptest.NewRequest("POST", "/v1/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("got %d: %s", rec.Code, rec.Body.String())
	}
	var tp service.TokenPair
	_ = json.Unmarshal(rec.Body.Bytes(), &tp)
	if tp.AccessToken == "" {
		t.Fatal("no access token")
	}
	if tp.RefreshToken == "" {
		t.Fatal("no refresh token")
	}
}

func TestLoginWrongPassword(t *testing.T) {
	h, p, tid, cleanup := setup(t)
	defer cleanup()
	var email string
	_ = p.QueryRow(context.Background(),
		"SELECT email FROM app_user WHERE tenant_id=$1 LIMIT 1", tid).Scan(&email)
	body, _ := json.Marshal(map[string]string{
		"tenant_id": tid.String(), "email": email, "password": "WRONG-pass-1234",
	})
	req := httptest.NewRequest("POST", "/v1/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("want 401 got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestJWKSEndpoint(t *testing.T) {
	h, _, _, cleanup := setup(t)
	defer cleanup()
	req := httptest.NewRequest("GET", "/.well-known/jwks.json", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("got %d", rec.Code)
	}
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	keys, _ := body["keys"].([]any)
	if len(keys) != 1 {
		t.Fatalf("expected 1 key, got %d (body=%s)", len(keys), rec.Body.String())
	}
}
