package api

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pquerna/otp/totp"

	libauth "github.com/pmplatform/libs/go/auth"
	"github.com/pmplatform/libs/go/audit"
	notiflib "github.com/pmplatform/libs/go/notification"

	"github.com/pmplatform/services/identity-svc/internal/domain"
	"github.com/pmplatform/services/identity-svc/internal/jwt"
	"github.com/pmplatform/services/identity-svc/internal/service"
	"github.com/pmplatform/services/identity-svc/internal/store"
)

// mfaTestMasterKey is a constant 32-byte hex key for tests. Anything stable
// here is fine — the per-tenant key derivation gives us isolation even
// across parallel test cases that happen to reuse this value.
const mfaTestMasterKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

type mfaSetup struct {
	h      http.Handler
	p      *pgxpool.Pool
	tid    uuid.UUID
	uid    uuid.UUID
	email  string
	signer *libauth.Signer
	kp     *jwt.KeyPair
}

func mfaTestSetup(t *testing.T) (*mfaSetup, func()) {
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
	slug := "mfa-" + uuid.NewString()[:6]
	if _, err := p.Exec(ctx,
		`INSERT INTO tenant(id, slug, name) VALUES ($1,$2,'M')`, tid, slug); err != nil {
		p.Close()
		t.Fatal(err)
	}

	pw, _ := domain.HashPassword("VeryStrong#1")
	uid := uuid.New()
	email := "mfa-" + uuid.NewString()[:6] + "@test.com"
	tx, _ := p.Begin(ctx)
	_, _ = tx.Exec(ctx, "SET LOCAL app.current_tenant = '"+tid.String()+"'")
	if _, err := tx.Exec(ctx,
		`INSERT INTO app_user(id, tenant_id, email, display_name, status, password_hash, version)
         VALUES ($1,$2,$3,'M','active',$4,1)`, uid, tid, email, pw); err != nil {
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
	mfaEnrollments := store.NewMFAEnrollments(p)

	auth := service.NewAuth(users, store.NewSessions(p), signer, pub, notiflib.NoopPublisher{}).
		WithRefreshTokens(tokens, 30*24*time.Hour).
		WithMFA(mfaEnrollments)
	refresh := service.NewRefresh(users, tokens, signer, pub)

	mfa, err := service.NewMFA(mfaEnrollments, users, mfaTestMasterKey, signer, pub)
	if err != nil {
		p.Close()
		t.Fatal(err)
	}

	h := NewRouterFull(auth, refresh, nil, mfa, kp, nil, "", nil, nil, nil)
	cleanup := func() {
		p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tid)
		p.Close()
	}
	return &mfaSetup{
		h:      h,
		p:      p,
		tid:    tid,
		uid:    uid,
		email:  email,
		signer: signer,
		kp:     kp,
	}, cleanup
}

// userAccessToken mints a bearer token for the seeded user — same shape
// the live Login produces. Used to call the auth-required MFA endpoints
// (enroll / verify / disable).
func (s *mfaSetup) userAccessToken(t *testing.T) string {
	t.Helper()
	tok, err := s.signer.Sign(libauth.Claims{
		Subject:  s.uid.String(),
		TenantID: s.tid.String(),
		Roles:    []string{},
		TTL:      5 * time.Minute,
	})
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func mfaPost(h http.Handler, path, bearer string, body any) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// extractTOTPSecret pulls the base32 secret out of an otpauth:// URL. The
// test then uses the same library the server uses (pquerna/otp/totp) to
// produce a valid code — no need to share state across the boundary.
func extractTOTPSecret(t *testing.T, otpauthURL string) string {
	t.Helper()
	u, err := url.Parse(otpauthURL)
	if err != nil {
		t.Fatalf("parse otpauth: %v", err)
	}
	q := u.Query()
	sec := q.Get("secret")
	if sec == "" {
		t.Fatalf("no secret in otpauth url: %s", otpauthURL)
	}
	return sec
}

func TestMFAEnrollAndVerify(t *testing.T) {
	s, cleanup := mfaTestSetup(t)
	defer cleanup()

	tok := s.userAccessToken(t)

	rec := mfaPost(s.h, "/v1/auth/mfa/enroll", tok, nil)
	if rec.Code != 200 {
		t.Fatalf("enroll: got %d: %s", rec.Code, rec.Body.String())
	}
	var er service.MFAEnrollResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &er)
	if er.OTPAuthURL == "" {
		t.Fatal("enroll: no otpauth_url")
	}
	if len(er.BackupCodes) != domain.BackupCodeCount {
		t.Fatalf("enroll: expected %d backup codes, got %d", domain.BackupCodeCount, len(er.BackupCodes))
	}
	secret := extractTOTPSecret(t, er.OTPAuthURL)
	t.Logf("enroll OK — otpauth_url=%s..., backup_codes=%d (elided)", er.OTPAuthURL[:32], len(er.BackupCodes))

	// Verify with a valid code.
	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	rec = mfaPost(s.h, "/v1/auth/mfa/verify", tok, map[string]string{"code": code})
	if rec.Code != 200 {
		t.Fatalf("verify: got %d: %s", rec.Code, rec.Body.String())
	}

	// Confirmed row must exist.
	var confirmedAt *time.Time
	if err := s.p.QueryRow(context.Background(),
		`SELECT confirmed_at FROM mfa_enrollment WHERE user_id=$1`, s.uid).Scan(&confirmedAt); err != nil {
		t.Fatal(err)
	}
	if confirmedAt == nil {
		t.Fatal("confirmed_at should be set after verify")
	}

	// Re-enroll over a confirmed row must 409.
	rec = mfaPost(s.h, "/v1/auth/mfa/enroll", tok, nil)
	if rec.Code != 409 {
		t.Fatalf("re-enroll should 409 over a confirmed row, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestMFALoginStepUpAndChallenge(t *testing.T) {
	s, cleanup := mfaTestSetup(t)
	defer cleanup()

	// Enroll + verify so the user is now MFA-required.
	tok := s.userAccessToken(t)
	rec := mfaPost(s.h, "/v1/auth/mfa/enroll", tok, nil)
	if rec.Code != 200 {
		t.Fatalf("enroll: %d: %s", rec.Code, rec.Body.String())
	}
	var er service.MFAEnrollResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &er)
	secret := extractTOTPSecret(t, er.OTPAuthURL)
	code, _ := totp.GenerateCode(secret, time.Now())
	rec = mfaPost(s.h, "/v1/auth/mfa/verify", tok, map[string]string{"code": code})
	if rec.Code != 200 {
		t.Fatalf("verify: %d: %s", rec.Code, rec.Body.String())
	}

	// Login must NOW return mfa_required + mfa_token, no access_token.
	body, _ := json.Marshal(map[string]string{
		"tenant_id": s.tid.String(), "email": s.email, "password": "VeryStrong#1",
	})
	req := httptest.NewRequest("POST", "/v1/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	s.h.ServeHTTP(rec2, req)
	if rec2.Code != 200 {
		t.Fatalf("login: %d: %s", rec2.Code, rec2.Body.String())
	}
	var lr service.LoginResponse
	_ = json.Unmarshal(rec2.Body.Bytes(), &lr)
	if !lr.MFARequired {
		t.Fatalf("expected mfa_required=true, got %+v", lr)
	}
	if lr.MFAToken == "" {
		t.Fatal("expected mfa_token")
	}
	if lr.TokenPair != nil && lr.AccessToken != "" {
		t.Fatal("login must not issue access_token when MFA is required")
	}

	// Wait so TOTP rotates — most generators reuse the same step; ours
	// uses the live secret so re-generating now is fine.
	chCode, _ := totp.GenerateCode(secret, time.Now())
	rec3 := mfaPost(s.h, "/v1/auth/mfa/challenge", "", map[string]string{
		"mfa_token": lr.MFAToken,
		"code":      chCode,
	})
	if rec3.Code != 200 {
		t.Fatalf("challenge: %d: %s", rec3.Code, rec3.Body.String())
	}
	var tp service.TokenPair
	_ = json.Unmarshal(rec3.Body.Bytes(), &tp)
	if tp.AccessToken == "" || tp.RefreshToken == "" {
		t.Fatalf("challenge: missing tokens: %+v", tp)
	}
}

func TestMFAChallengeWithBackupCodeIsSingleUse(t *testing.T) {
	s, cleanup := mfaTestSetup(t)
	defer cleanup()

	tok := s.userAccessToken(t)
	rec := mfaPost(s.h, "/v1/auth/mfa/enroll", tok, nil)
	if rec.Code != 200 {
		t.Fatalf("enroll: %d", rec.Code)
	}
	var er service.MFAEnrollResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &er)
	secret := extractTOTPSecret(t, er.OTPAuthURL)
	code, _ := totp.GenerateCode(secret, time.Now())
	rec = mfaPost(s.h, "/v1/auth/mfa/verify", tok, map[string]string{"code": code})
	if rec.Code != 200 {
		t.Fatalf("verify: %d", rec.Code)
	}

	// Login → mfa_token.
	body, _ := json.Marshal(map[string]string{
		"tenant_id": s.tid.String(), "email": s.email, "password": "VeryStrong#1",
	})
	req := httptest.NewRequest("POST", "/v1/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	s.h.ServeHTTP(rec2, req)
	var lr service.LoginResponse
	_ = json.Unmarshal(rec2.Body.Bytes(), &lr)
	if lr.MFAToken == "" {
		t.Fatal("no mfa_token")
	}

	backup := er.BackupCodes[0]
	rec3 := mfaPost(s.h, "/v1/auth/mfa/challenge", "", map[string]string{
		"mfa_token": lr.MFAToken,
		"code":      backup,
	})
	if rec3.Code != 200 {
		t.Fatalf("challenge w/ backup code: %d: %s", rec3.Code, rec3.Body.String())
	}

	// The consumed code must no longer be present in the row.
	var codes []string
	if err := s.p.QueryRow(context.Background(),
		`SELECT backup_codes_hashed FROM mfa_enrollment WHERE user_id=$1`, s.uid).Scan(&codes); err != nil {
		t.Fatal(err)
	}
	if len(codes) != domain.BackupCodeCount-1 {
		t.Fatalf("expected backup_codes_hashed len %d after consume, got %d",
			domain.BackupCodeCount-1, len(codes))
	}

	// Replay the same backup code on a fresh mfa_token must FAIL.
	req = httptest.NewRequest("POST", "/v1/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec4 := httptest.NewRecorder()
	s.h.ServeHTTP(rec4, req)
	var lr2 service.LoginResponse
	_ = json.Unmarshal(rec4.Body.Bytes(), &lr2)
	if lr2.MFAToken == "" {
		t.Fatal("no mfa_token on second login")
	}
	rec5 := mfaPost(s.h, "/v1/auth/mfa/challenge", "", map[string]string{
		"mfa_token": lr2.MFAToken,
		"code":      backup,
	})
	if rec5.Code != 401 {
		t.Fatalf("replayed backup code must 401, got %d: %s", rec5.Code, rec5.Body.String())
	}
}

func TestMFAChallengeFailedCodeFails(t *testing.T) {
	s, cleanup := mfaTestSetup(t)
	defer cleanup()

	tok := s.userAccessToken(t)
	rec := mfaPost(s.h, "/v1/auth/mfa/enroll", tok, nil)
	if rec.Code != 200 {
		t.Fatalf("enroll: %d", rec.Code)
	}
	var er service.MFAEnrollResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &er)
	secret := extractTOTPSecret(t, er.OTPAuthURL)
	code, _ := totp.GenerateCode(secret, time.Now())
	rec = mfaPost(s.h, "/v1/auth/mfa/verify", tok, map[string]string{"code": code})
	if rec.Code != 200 {
		t.Fatalf("verify: %d", rec.Code)
	}

	body, _ := json.Marshal(map[string]string{
		"tenant_id": s.tid.String(), "email": s.email, "password": "VeryStrong#1",
	})
	req := httptest.NewRequest("POST", "/v1/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	s.h.ServeHTTP(rec2, req)
	var lr service.LoginResponse
	_ = json.Unmarshal(rec2.Body.Bytes(), &lr)

	// Bogus 6-digit code must fail with 401.
	rec3 := mfaPost(s.h, "/v1/auth/mfa/challenge", "", map[string]string{
		"mfa_token": lr.MFAToken,
		"code":      "000000",
	})
	if rec3.Code != 401 {
		t.Fatalf("bogus code must 401, got %d: %s", rec3.Code, rec3.Body.String())
	}
}

func TestMFADisableRequiresPassword(t *testing.T) {
	s, cleanup := mfaTestSetup(t)
	defer cleanup()

	tok := s.userAccessToken(t)
	rec := mfaPost(s.h, "/v1/auth/mfa/enroll", tok, nil)
	if rec.Code != 200 {
		t.Fatalf("enroll: %d", rec.Code)
	}
	var er service.MFAEnrollResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &er)
	secret := extractTOTPSecret(t, er.OTPAuthURL)
	code, _ := totp.GenerateCode(secret, time.Now())
	rec = mfaPost(s.h, "/v1/auth/mfa/verify", tok, map[string]string{"code": code})
	if rec.Code != 200 {
		t.Fatalf("verify: %d", rec.Code)
	}

	// Wrong password must 401, row must remain.
	rec = mfaPost(s.h, "/v1/auth/mfa/disable", tok, map[string]string{
		"current_password": "WRONG-pw-1234",
	})
	if rec.Code != 401 {
		t.Fatalf("disable w/ wrong pw must 401, got %d: %s", rec.Code, rec.Body.String())
	}
	var n int
	_ = s.p.QueryRow(context.Background(),
		`SELECT count(*) FROM mfa_enrollment WHERE user_id=$1`, s.uid).Scan(&n)
	if n != 1 {
		t.Fatalf("enrollment row should remain after failed disable, got count=%d", n)
	}

	// Right password disables the row.
	rec = mfaPost(s.h, "/v1/auth/mfa/disable", tok, map[string]string{
		"current_password": "VeryStrong#1",
	})
	if rec.Code != 200 {
		t.Fatalf("disable: %d: %s", rec.Code, rec.Body.String())
	}
	_ = s.p.QueryRow(context.Background(),
		`SELECT count(*) FROM mfa_enrollment WHERE user_id=$1`, s.uid).Scan(&n)
	if n != 0 {
		t.Fatalf("enrollment row should be gone after disable, got count=%d", n)
	}

	// And login must now return a real session (no mfa_required).
	body, _ := json.Marshal(map[string]string{
		"tenant_id": s.tid.String(), "email": s.email, "password": "VeryStrong#1",
	})
	req := httptest.NewRequest("POST", "/v1/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	s.h.ServeHTTP(rec2, req)
	if rec2.Code != 200 {
		t.Fatalf("login post-disable: %d: %s", rec2.Code, rec2.Body.String())
	}
	var lr service.LoginResponse
	_ = json.Unmarshal(rec2.Body.Bytes(), &lr)
	if lr.MFARequired {
		t.Fatal("login post-disable must not require mfa")
	}
	if lr.TokenPair == nil || lr.AccessToken == "" {
		t.Fatalf("login post-disable must issue access token, got %+v", lr)
	}
}

// Silence unused-import warnings if subsets of the file are run.
var _ = hex.EncodeToString
