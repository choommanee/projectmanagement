package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
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

func setup(t *testing.T) (http.Handler, *pgxpool.Pool, uuid.UUID, func()) {
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

	// Use PG publisher for tests (no NATS dependency)
	pub := audit.NewPgPublisher(p, "test")
	auth := service.NewAuth(store.NewUsers(p), store.NewSessions(p), signer, pub, notiflib.NoopPublisher{})

	// nil Store -> JWKS handler falls back to the in-memory keypair so tests
	// remain insulated from the DB-backed signing_key row. Empty issuer
	// disables the admin rotate endpoint (covered by rotation integration tests).
	h := NewRouter(auth, kp, nil, "", nil)
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

func TestLoginPopulatesRolesClaim(t *testing.T) {
	h, p, tid, cleanup := setup(t)
	defer cleanup()

	ctx := context.Background()

	// Resolve the user we just seeded in setup() and attach a role to them.
	var uid uuid.UUID
	var email string
	if err := p.QueryRow(ctx,
		"SELECT id, email FROM app_user WHERE tenant_id=$1 LIMIT 1", tid).Scan(&uid, &email); err != nil {
		t.Fatal(err)
	}

	roleID := uuid.New()
	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, "SET LOCAL app.current_tenant = '"+tid.String()+"'"); err != nil {
		tx.Rollback(ctx)
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO role(id, tenant_id, name) VALUES ($1,$2,'platform-admin')`, roleID, tid); err != nil {
		tx.Rollback(ctx)
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO role_assignment(tenant_id, user_id, role_id) VALUES ($1,$2,$3)`,
		tid, uid, roleID); err != nil {
		tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]string{
		"tenant_id": tid.String(), "email": email, "password": "VeryStrong#1",
	})
	req := httptest.NewRequest("POST", "/v1/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("login got %d: %s", rec.Code, rec.Body.String())
	}
	var tp service.TokenPair
	_ = json.Unmarshal(rec.Body.Bytes(), &tp)
	if tp.AccessToken == "" {
		t.Fatal("no access token")
	}

	// Decode the JWT payload (middle segment) and assert roles contains
	// "platform-admin". We don't verify the signature here — TestJWKS covers
	// that path; here we only assert the claim shape.
	parts := strings.Split(tp.AccessToken, ".")
	if len(parts) != 3 {
		t.Fatalf("unexpected JWT shape: %d parts", len(parts))
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	rolesAny, ok := payload["roles"].([]any)
	if !ok {
		t.Fatalf("roles claim missing or wrong shape: %#v", payload["roles"])
	}
	found := false
	for _, r := range rolesAny {
		if s, _ := r.(string); s == "platform-admin" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected roles to contain platform-admin, got %#v", rolesAny)
	}
	t.Logf("decoded JWT roles claim: %v", rolesAny)
}

// seedUser inserts an app_user with the given password and returns its id+email.
func seedUser(t *testing.T, p *pgxpool.Pool, tid uuid.UUID, password string) (uuid.UUID, string) {
	t.Helper()
	ctx := context.Background()
	pw, _ := domain.HashPassword(password)
	uid := uuid.New()
	email := "su-" + uuid.NewString()[:6] + "@test.com"
	tx, _ := p.Begin(ctx)
	_, _ = tx.Exec(ctx, "SET LOCAL app.current_tenant = '"+tid.String()+"'")
	if _, err := tx.Exec(ctx,
		`INSERT INTO app_user(id, tenant_id, email, display_name, status, password_hash, version)
         VALUES ($1,$2,$3,'Orig','active',$4,1)`, uid, tid, email, pw); err != nil {
		tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return uid, email
}

// userRouter mounts the user-management routes with claims injected on every
// request, so we can exercise the self-edit / change-password authz logic.
func userRouter(users *store.Users, claims *libauth.ParsedClaims) http.Handler {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(libauth.WithClaims(req.Context(), claims)))
		})
	})
	r.Patch("/v1/users/{id}", updateUser(users))
	r.Post("/v1/users/{id}/password", changePassword(users))
	return r
}

func TestSelfEditDisplayNameNonAdmin(t *testing.T) {
	_, p, tid, cleanup := setup(t)
	defer cleanup()
	users := store.NewUsers(p)
	uid, _ := seedUser(t, p, tid, "VeryStrong#1")

	// non-admin claims (no roles) editing OWN display_name -> allowed
	claims := &libauth.ParsedClaims{Subject: uid.String(), TenantID: tid.String()}
	h := userRouter(users, claims)

	body, _ := json.Marshal(map[string]any{"display_name": "Renamed"})
	req := httptest.NewRequest("PATCH", "/v1/users/"+uid.String(), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("self display_name edit: want 200 got %d: %s", rec.Code, rec.Body.String())
	}
	var name string
	_ = p.QueryRow(context.Background(), "SELECT display_name FROM app_user WHERE id=$1", uid).Scan(&name)
	if name != "Renamed" {
		t.Fatalf("display_name not persisted, got %q", name)
	}
}

func TestNonAdminCannotEditOthersOrRoles(t *testing.T) {
	_, p, tid, cleanup := setup(t)
	defer cleanup()
	users := store.NewUsers(p)
	uid, _ := seedUser(t, p, tid, "VeryStrong#1")
	other, _ := seedUser(t, p, tid, "VeryStrong#2")

	claims := &libauth.ParsedClaims{Subject: uid.String(), TenantID: tid.String()}
	h := userRouter(users, claims)

	// editing a different user -> 403
	body, _ := json.Marshal(map[string]any{"display_name": "Hacked"})
	req := httptest.NewRequest("PATCH", "/v1/users/"+other.String(), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatalf("cross-user edit: want 403 got %d: %s", rec.Code, rec.Body.String())
	}

	// self role change by non-admin -> 403 (privilege escalation guard)
	body2, _ := json.Marshal(map[string]any{"roles": []string{"platform-admin"}})
	req2 := httptest.NewRequest("PATCH", "/v1/users/"+uid.String(), bytes.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	h.ServeHTTP(rec2, req2)
	if rec2.Code != 403 {
		t.Fatalf("self role change: want 403 got %d: %s", rec2.Code, rec2.Body.String())
	}
}

func TestChangePasswordSelf(t *testing.T) {
	_, p, tid, cleanup := setup(t)
	defer cleanup()
	users := store.NewUsers(p)
	uid, _ := seedUser(t, p, tid, "VeryStrong#1")
	other, _ := seedUser(t, p, tid, "VeryStrong#2")

	claims := &libauth.ParsedClaims{Subject: uid.String(), TenantID: tid.String()}
	h := userRouter(users, claims)

	// wrong current password -> 400
	b1, _ := json.Marshal(map[string]string{"current_password": "WRONG-pass-1", "password": "NewStrong#123"})
	r1 := httptest.NewRequest("POST", "/v1/users/"+uid.String()+"/password", bytes.NewReader(b1))
	r1.Header.Set("Content-Type", "application/json")
	w1 := httptest.NewRecorder()
	h.ServeHTTP(w1, r1)
	if w1.Code != 400 {
		t.Fatalf("wrong current: want 400 got %d: %s", w1.Code, w1.Body.String())
	}

	// correct current password -> 204
	b2, _ := json.Marshal(map[string]string{"current_password": "VeryStrong#1", "password": "NewStrong#123"})
	r2 := httptest.NewRequest("POST", "/v1/users/"+uid.String()+"/password", bytes.NewReader(b2))
	r2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	h.ServeHTTP(w2, r2)
	if w2.Code != 204 {
		t.Fatalf("change password: want 204 got %d: %s", w2.Code, w2.Body.String())
	}
	// new hash must verify
	u, err := users.FindByID(context.Background(), tid, uid)
	if err != nil {
		t.Fatal(err)
	}
	if err := domain.CheckPassword(u.PasswordHash, "NewStrong#123"); err != nil {
		t.Fatalf("new password does not verify: %v", err)
	}

	// changing another user's password -> 403
	b3, _ := json.Marshal(map[string]string{"current_password": "VeryStrong#2", "password": "NewStrong#999"})
	r3 := httptest.NewRequest("POST", "/v1/users/"+other.String()+"/password", bytes.NewReader(b3))
	r3.Header.Set("Content-Type", "application/json")
	w3 := httptest.NewRecorder()
	h.ServeHTTP(w3, r3)
	if w3.Code != 403 {
		t.Fatalf("cross-user password: want 403 got %d: %s", w3.Code, w3.Body.String())
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
