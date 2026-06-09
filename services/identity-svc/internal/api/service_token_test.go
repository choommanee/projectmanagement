package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	libauth "github.com/pmplatform/libs/go/auth"

	sjwt "github.com/pmplatform/services/identity-svc/internal/jwt"
	"github.com/pmplatform/services/identity-svc/internal/service"
)

// stRouter builds a minimal router with the service-token endpoint mounted on
// top of a live Store-backed signer so the minted token verifies through the
// same JWKS path real services use.
func stServerWithSecret(t *testing.T, secret string) (http.Handler, *sjwt.Store, string) {
	t.Helper()
	p := rotateTestPool(t)
	lockSigningKeys(t, p)

	ctx := context.Background()
	kid := "svc-token-" + time.Now().Format("150405.000000")
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), "DELETE FROM signing_key WHERE kid LIKE 'svc-token-%'")
	})
	kp, err := sjwt.LoadOrCreate(ctx, p, kid)
	if err != nil {
		t.Fatal(err)
	}
	ks := sjwt.NewStore(p, 24*time.Hour)
	ks.Bind(kp, kid)
	if err := ks.Refresh(ctx); err != nil {
		t.Fatalf("refresh: %v", err)
	}
	issuer := "http://test/" + kid
	signer := sjwt.NewDynamicSigner(ks, issuer)

	h := NewRouter(nil, kp, ks, issuer, nil)
	st := service.NewServiceToken(signer, secret, nil)
	h = WithServiceToken(h, st)
	return h, ks, issuer
}

func postServiceToken(t *testing.T, h http.Handler, secret, svc, tenant string) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"service": svc, "tenant_id": tenant})
	req := httptest.NewRequest("POST", "/v1/internal/service-token", bytes.NewReader(body))
	if secret != "" {
		req.Header.Set("X-Service-Secret", secret)
	}
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestServiceToken_MintsVerifiableTokenWithWorkflowRole(t *testing.T) {
	h, ks, issuer := stServerWithSecret(t, "top-secret")
	tenant := "11111111-1111-1111-1111-111111111111"

	rec := postServiceToken(t, h, "top-secret", "workflow-svc", tenant)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		AccessToken string    `json:"access_token"`
		ExpiresAt   time.Time `json:"expires_at"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.AccessToken == "" {
		t.Fatal("empty access_token")
	}

	// Verify the token through the normal JWKS path other services use.
	set, err := ks.JWKS(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	claims, err := libauth.NewVerifier(set, issuer).Verify(resp.AccessToken)
	if err != nil {
		t.Fatalf("token must verify via JWKS: %v", err)
	}
	if claims.Subject != "svc:workflow-svc" {
		t.Fatalf("subject = %q, want svc:workflow-svc", claims.Subject)
	}
	if claims.TenantID != tenant {
		t.Fatalf("tenant = %q, want %q", claims.TenantID, tenant)
	}
	hasRole := false
	for _, r := range claims.Roles {
		if r == "workflow-service" {
			hasRole = true
		}
	}
	if !hasRole {
		t.Fatalf("roles = %v, want to contain workflow-service", claims.Roles)
	}
	// TTL should be short (~10m), not 15m or longer.
	if d := time.Until(claims.ExpireAt); d > 11*time.Minute {
		t.Fatalf("ttl too long: %v", d)
	}
}

func TestServiceToken_WrongSecretIsForbidden(t *testing.T) {
	h, _, _ := stServerWithSecret(t, "top-secret")
	rec := postServiceToken(t, h, "wrong-secret", "workflow-svc",
		"11111111-1111-1111-1111-111111111111")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403 got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServiceToken_DisabledWhenSecretUnset(t *testing.T) {
	// Empty secret => endpoint not mounted => 404, never a mint.
	h, _, _ := stServerWithSecret(t, "")
	rec := postServiceToken(t, h, "anything", "workflow-svc",
		"11111111-1111-1111-1111-111111111111")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404 (endpoint disabled) got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestServiceToken_BadTenantRejected(t *testing.T) {
	h, _, _ := stServerWithSecret(t, "top-secret")
	rec := postServiceToken(t, h, "top-secret", "workflow-svc", "not-a-uuid")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400 got %d: %s", rec.Code, rec.Body.String())
	}
}
