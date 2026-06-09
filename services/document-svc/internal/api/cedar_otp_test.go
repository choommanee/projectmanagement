package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	libauth "github.com/pmplatform/libs/go/auth"
	libpolicy "github.com/pmplatform/libs/policy"
)

// TestOTPStepUpHTTPFlow exercises the full email-OTP ceremony over HTTP with
// the REAL Cedar bundle: 428 without code, 403 cross-signer request, 200
// request with dev code, 403 wrong code, 200 correct code, unaffected
// standard signer completes the envelope.
func TestOTPStepUpHTTPFlow(t *testing.T) {
	t.Setenv("OTP_DEV_EXPOSE", "true")
	p := cedarTestPool(t)
	defer p.Close()
	tid := seedCedarTenant(t, p)
	pid := seedCedarProject(t, p, tid)
	docID := seedSignDoc(t, p, tid, pid)

	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	authz := &libpolicy.Adapter{Policies: ps}
	router := signRouter(p, authz)

	signerA := uuid.New() // email_otp
	signerB := uuid.New() // session
	mkClient := func(sub uuid.UUID) func(method, path string, payload any) *httptest.ResponseRecorder {
		h := withClaims(router, &libauth.ParsedClaims{Subject: sub.String(), TenantID: tid.String(), Roles: []string{"project-manager"}, ExpireAt: time.Now().Add(time.Minute)})
		return func(method, path string, payload any) *httptest.ResponseRecorder {
			var rdr *bytes.Reader
			if payload != nil {
				b, _ := json.Marshal(payload)
				rdr = bytes.NewReader(b)
			} else {
				rdr = bytes.NewReader(nil)
			}
			req := httptest.NewRequest(method, path, rdr)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("X-Tenant-Id", tid.String())
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			return rec
		}
	}
	asA := mkClient(signerA)
	asB := mkClient(signerB)

	rec := asA(http.MethodPost, "/v1/documents/"+docID.String()+"/sign-envelopes", map[string]any{
		"signing_order": "parallel",
		"signers": []map[string]any{
			{"signer_id": signerA.String(), "name": "A", "email": "a@x.com", "auth_method": "email_otp"},
			{"signer_id": signerB.String(), "name": "B", "email": "b@x.com"},
		},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var env struct {
		ID      string `json:"id"`
		Signers []struct {
			ID         string `json:"id"`
			AuthMethod string `json:"auth_method"`
		} `json:"signers"`
	}
	json.Unmarshal(rec.Body.Bytes(), &env)
	if len(env.Signers) != 2 || env.Signers[0].AuthMethod != "email_otp" {
		t.Fatalf("bad envelope: %s", rec.Body.String())
	}
	rowA, rowB := env.Signers[0].ID, env.Signers[1].ID

	if rec := asA(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/send", nil); rec.Code != 200 {
		t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
	}

	// A signs without a code → 428 otp_required.
	if rec := asA(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/signers/"+rowA+"/sign",
		map[string]any{"consent": true, "typed_name": "A"}); rec.Code != http.StatusPreconditionRequired {
		t.Fatalf("sign without code: want 428, got %d %s", rec.Code, rec.Body.String())
	}

	// B requests A's OTP → 403 (actor enforcement in the service).
	if rec := asB(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/signers/"+rowA+"/otp/request", nil); rec.Code != http.StatusForbidden {
		t.Fatalf("cross otp request: want 403, got %d %s", rec.Code, rec.Body.String())
	}

	// A requests their own OTP → 200 + dev_code (OTP_DEV_EXPOSE=true).
	rec = asA(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/signers/"+rowA+"/otp/request", nil)
	if rec.Code != 200 {
		t.Fatalf("otp request: %d %s", rec.Code, rec.Body.String())
	}
	var ch struct {
		ChallengeID string `json:"challenge_id"`
		DevCode     string `json:"dev_code"`
	}
	json.Unmarshal(rec.Body.Bytes(), &ch)
	if ch.DevCode == "" {
		t.Fatalf("dev_code missing: %s", rec.Body.String())
	}

	// A signs with a WRONG code → 403 otp_invalid.
	wrong := "000000"
	if wrong == ch.DevCode {
		wrong = "999999"
	}
	rec = asA(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/signers/"+rowA+"/sign",
		map[string]any{"consent": true, "typed_name": "A", "otp_code": wrong})
	if rec.Code != http.StatusForbidden || !bytes.Contains(rec.Body.Bytes(), []byte("otp_invalid")) {
		t.Fatalf("wrong code: want 403 otp_invalid, got %d %s", rec.Code, rec.Body.String())
	}

	// A signs with the correct code → 200.
	rec = asA(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/signers/"+rowA+"/sign",
		map[string]any{"consent": true, "typed_name": "A", "otp_code": ch.DevCode})
	if rec.Code != 200 {
		t.Fatalf("sign with code: %d %s", rec.Code, rec.Body.String())
	}

	// B signs normally (no OTP involvement) → 200 + envelope completed.
	rec = asB(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/signers/"+rowB+"/sign",
		map[string]any{"consent": true, "typed_name": "B"})
	if rec.Code != 200 {
		t.Fatalf("B sign: %d %s", rec.Code, rec.Body.String())
	}
	var signResp struct {
		Completed bool `json:"completed"`
	}
	json.Unmarshal(rec.Body.Bytes(), &signResp)
	if !signResp.Completed {
		t.Fatalf("expected completed envelope: %s", rec.Body.String())
	}

	// Verify endpoint still reports a valid chain and surfaces auth_method.
	rec = asA(http.MethodGet, "/v1/sign-envelopes/"+env.ID+"/verify", nil)
	if rec.Code != 200 {
		t.Fatalf("verify: %d %s", rec.Code, rec.Body.String())
	}
	var vr struct {
		Valid bool `json:"valid"`
		Links []struct {
			AuthMethod string `json:"auth_method"`
		} `json:"links"`
	}
	json.Unmarshal(rec.Body.Bytes(), &vr)
	if !vr.Valid {
		t.Fatalf("chain invalid: %s", rec.Body.String())
	}
	if len(vr.Links) != 2 || vr.Links[0].AuthMethod != "email_otp" {
		t.Fatalf("verify missing auth_method: %s", rec.Body.String())
	}

	// Audit trail contains otp_requested + otp_verified.
	rec = asA(http.MethodGet, "/v1/sign-envelopes/"+env.ID+"/audit", nil)
	if rec.Code != 200 {
		t.Fatalf("audit: %d", rec.Code)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("otp_verified")) ||
		!bytes.Contains(rec.Body.Bytes(), []byte("otp_requested")) {
		t.Fatalf("audit missing otp events: %s", rec.Body.String())
	}

	// Certificate PDF renders (OTP line presence is asserted in service tests
	// via auth_evidence; here we assert the PDF still generates).
	rec = asA(http.MethodGet, "/v1/sign-envelopes/"+env.ID+"/certificate", nil)
	if rec.Code != 200 || !bytes.HasPrefix(rec.Body.Bytes(), []byte("%PDF")) {
		t.Fatalf("certificate: %d", rec.Code)
	}
}
