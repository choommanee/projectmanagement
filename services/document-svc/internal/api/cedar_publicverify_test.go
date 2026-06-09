package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	libauth "github.com/pmplatform/libs/go/auth"
	libpolicy "github.com/pmplatform/libs/policy"

	"github.com/pmplatform/services/document-svc/internal/api"
	"github.com/pmplatform/services/document-svc/internal/domain"
	"github.com/pmplatform/services/document-svc/internal/service"
	"github.com/pmplatform/services/document-svc/internal/store"
)

// publicVerifyRouter builds a router wired exactly like production, including
// the VerifyLinks store (Team F public verification).
func publicVerifyRouter(p *pgxpool.Pool, authz libauth.Authorizer) http.Handler {
	svc := service.New(store.NewWorkspaces(p), store.NewDocuments(p), store.NewComments(p), store.NewTemplates(p)).
		WithSignatures(store.NewSignatures(p)).
		WithVerifyLinks(store.NewVerifyLinks(p))
	return api.NewRouterWithLoader(svc, authz, api.NewCedarLoader(p))
}

// completeEnvelope drives a doc through create→send→sign so the envelope is
// completed and a verify link can be minted. Returns the envelope id.
func completeEnvelope(t *testing.T, h http.Handler, tid uuid.UUID, docID uuid.UUID, signerUUID uuid.UUID) string {
	t.Helper()
	do := func(method, path string, payload any) *httptest.ResponseRecorder {
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
	rec := do(http.MethodPost, "/v1/documents/"+docID.String()+"/sign-envelopes", map[string]any{
		"signing_order": "parallel",
		"signers":       []map[string]any{{"signer_id": signerUUID.String(), "name": "Fern Verifier", "email": "fern@example.co"}},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create env: %d %s", rec.Code, rec.Body.String())
	}
	var env struct {
		ID      string `json:"id"`
		Signers []struct {
			ID string `json:"id"`
		} `json:"signers"`
	}
	json.Unmarshal(rec.Body.Bytes(), &env)
	if rec := do(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/send", nil); rec.Code != 200 {
		t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
	}
	rec = do(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/signers/"+env.Signers[0].ID+"/sign", map[string]any{
		"consent": true, "typed_name": "Fern Verifier", "auth_method": "typed_name",
	})
	if rec.Code != 200 {
		t.Fatalf("sign: %d %s", rec.Code, rec.Body.String())
	}
	return env.ID
}

// TestPublicVerifyLifecycle covers: Cedar allow/deny on link creation, the
// hash-only persistence invariant, the anonymous public report (masked
// emails, no IPs/UUIDs), access_count accounting, tamper detection, the
// public certificate, and revocation/unknown-token 404 indistinguishability.
func TestPublicVerifyLifecycle(t *testing.T) {
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
	router := publicVerifyRouter(p, authz)

	signerUUID := uuid.New()
	pm := withClaims(router, &libauth.ParsedClaims{Subject: signerUUID.String(), TenantID: tid.String(), Roles: []string{"project-manager"}, ExpireAt: time.Now().Add(time.Minute)})
	envID := completeEnvelope(t, pm, tid, docID, signerUUID)
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM document_verify_link WHERE envelope_id=$1", envID)
	})

	authedReq := func(h http.Handler, method, path string, payload any) *httptest.ResponseRecorder {
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

	// Cedar deny: mfg-operator must not mint links.
	op := withClaims(router, &libauth.ParsedClaims{Subject: uuid.NewString(), TenantID: tid.String(), Roles: []string{"mfg-operator"}, ExpireAt: time.Now().Add(time.Minute)})
	if rec := authedReq(op, http.MethodPost, "/v1/sign-envelopes/"+envID+"/verify-links", nil); rec.Code != http.StatusForbidden {
		t.Fatalf("mfg-operator create link: want 403 got %d %s", rec.Code, rec.Body.String())
	}

	// Cedar allow: project-manager mints; raw token returned once.
	rec := authedReq(pm, http.MethodPost, "/v1/sign-envelopes/"+envID+"/verify-links", nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create link: %d %s", rec.Code, rec.Body.String())
	}
	var created struct {
		Token     string `json:"token"`
		PublicURL string `json:"public_url"`
		Link      struct {
			ID string `json:"id"`
		} `json:"link"`
	}
	json.Unmarshal(rec.Body.Bytes(), &created)
	if created.Token == "" || created.Link.ID == "" || !strings.Contains(created.PublicURL, "/verify/"+created.Token) {
		t.Fatalf("bad create payload: %s", rec.Body.String())
	}

	// Hash-only persistence: the raw token must NOT appear in the DB.
	var stored string
	if err := p.QueryRow(context.Background(),
		"SELECT token_hash FROM document_verify_link WHERE id=$1", created.Link.ID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == created.Token || stored != store.HashVerifyToken(created.Token) {
		t.Fatalf("token_hash must be the SHA-256 of the raw token, never the raw token")
	}

	// Anonymous public report: no claims, no tenant header, no auth.
	pub := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req) // router WITHOUT withClaims
		return rec
	}
	rec = pub("/public/verify/" + created.Token)
	if rec.Code != 200 {
		t.Fatalf("public verify: %d %s", rec.Code, rec.Body.String())
	}
	var report domain.PublicVerifyReport
	json.Unmarshal(rec.Body.Bytes(), &report)
	if !report.Valid || report.Status != domain.EnvCompleted || !report.CertificateOK {
		t.Fatalf("want valid completed report: %s", rec.Body.String())
	}
	if report.EnvelopeShortID != envID[:8] {
		t.Fatalf("short id: want %s got %s", envID[:8], report.EnvelopeShortID)
	}
	if len(report.Signers) != 1 || report.Signers[0].EmailMasked != "f•••@e…" {
		t.Fatalf("email must be masked: %s", rec.Body.String())
	}
	body := rec.Body.String()
	for _, leak := range []string{"fern@example.co", signerUUID.String(), tid.String(), docID.String(), "ip_address", "user_agent"} {
		if strings.Contains(body, leak) {
			t.Fatalf("public report leaks %q: %s", leak, body)
		}
	}
	if report.DocumentHash == "" || report.Checks.EventChain != domain.EventChainValid ||
		!report.Checks.RecordChainValid || report.Checks.RecordSignatures != "valid" {
		t.Fatalf("chain checks wrong: %s", body)
	}

	// access_count incremented.
	var count int
	if err := p.QueryRow(context.Background(),
		"SELECT access_count FROM document_verify_link WHERE id=$1", created.Link.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("access_count: want 1 got %d", count)
	}

	// Tamper the signed content → report flips invalid; then restore. The
	// seeded doc has no version snapshot (seedSignDoc inserts the document
	// row only), so the envelope binds to the live document body.
	var origBody []byte
	if err := p.QueryRow(context.Background(),
		"SELECT body FROM document WHERE id=$1", docID).Scan(&origBody); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(context.Background(),
		`UPDATE document SET body='{"type":"doc","tampered":true}'::jsonb WHERE id=$1`, docID); err != nil {
		t.Fatal(err)
	}
	rec = pub("/public/verify/" + created.Token)
	var tampered domain.PublicVerifyReport
	json.Unmarshal(rec.Body.Bytes(), &tampered)
	if rec.Code != 200 || tampered.Valid {
		t.Fatalf("tampered doc must report invalid: %d %s", rec.Code, rec.Body.String())
	}
	if _, err := p.Exec(context.Background(),
		`UPDATE document SET body=$2::jsonb WHERE id=$1`, docID, string(origBody)); err != nil {
		t.Fatal(err)
	}
	rec = pub("/public/verify/" + created.Token)
	json.Unmarshal(rec.Body.Bytes(), &report)
	if !report.Valid {
		t.Fatalf("restored doc must verify again: %s", rec.Body.String())
	}

	// Public certificate PDF.
	rec = pub("/public/verify/" + created.Token + "/certificate")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/pdf" || !bytes.HasPrefix(rec.Body.Bytes(), []byte("%PDF")) {
		t.Fatalf("public certificate: %d ct=%q", rec.Code, rec.Header().Get("Content-Type"))
	}

	// Unknown token → 404.
	if rec := pub("/public/verify/not-a-real-token"); rec.Code != http.StatusNotFound {
		t.Fatalf("unknown token: want 404 got %d", rec.Code)
	}

	// Revoke (PM) → public lookup 404, indistinguishable from unknown.
	if rec := authedReq(pm, http.MethodDelete, "/v1/sign-envelopes/"+envID+"/verify-links/"+created.Link.ID, nil); rec.Code != 200 {
		t.Fatalf("revoke: %d %s", rec.Code, rec.Body.String())
	}
	if rec := pub("/public/verify/" + created.Token); rec.Code != http.StatusNotFound {
		t.Fatalf("revoked token: want 404 got %d %s", rec.Code, rec.Body.String())
	}
	if rec := pub("/public/verify/" + created.Token + "/certificate"); rec.Code != http.StatusNotFound {
		t.Fatalf("revoked token certificate: want 404 got %d", rec.Code)
	}

	// Revoke is also Cedar-gated.
	if rec := authedReq(op, http.MethodDelete, "/v1/sign-envelopes/"+envID+"/verify-links/"+created.Link.ID, nil); rec.Code != http.StatusForbidden {
		t.Fatalf("mfg-operator revoke: want 403 got %d", rec.Code)
	}
}

// TestVerifyLinkRequiresCompletedEnvelope: links cannot be minted for drafts.
func TestVerifyLinkRequiresCompletedEnvelope(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()
	tid := seedCedarTenant(t, p)
	pid := seedCedarProject(t, p, tid)
	docID := seedSignDoc(t, p, tid, pid)

	ps, _ := libpolicy.LoadShared()
	authz := &libpolicy.Adapter{Policies: ps}
	router := publicVerifyRouter(p, authz)
	pm := withClaims(router, &libauth.ParsedClaims{Subject: uuid.NewString(), TenantID: tid.String(), Roles: []string{"project-manager"}, ExpireAt: time.Now().Add(time.Minute)})

	body, _ := json.Marshal(map[string]any{
		"signing_order": "parallel",
		"signers":       []map[string]any{{"signer_id": uuid.NewString(), "email": "x@y.co"}},
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/documents/"+docID.String()+"/sign-envelopes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-Id", tid.String())
	rec := httptest.NewRecorder()
	pm.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var env struct {
		ID string `json:"id"`
	}
	json.Unmarshal(rec.Body.Bytes(), &env)

	req = httptest.NewRequest(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/verify-links", bytes.NewReader(nil))
	req.Header.Set("X-Tenant-Id", tid.String())
	rec = httptest.NewRecorder()
	pm.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("draft envelope link: want 400 got %d %s", rec.Code, rec.Body.String())
	}
}

// TestResolveByTokenHashWithoutTenantGUC pins the RLS exception contract: the
// public resolver finds the row with NO app.current_tenant set, and expiry
// filtering happens in the service (expired → 404).
func TestResolveByTokenHashWithoutTenantGUC(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()
	tid := seedCedarTenant(t, p)
	pid := seedCedarProject(t, p, tid)
	docID := seedSignDoc(t, p, tid, pid)

	ps, _ := libpolicy.LoadShared()
	authz := &libpolicy.Adapter{Policies: ps}
	router := publicVerifyRouter(p, authz)
	signerUUID := uuid.New()
	pm := withClaims(router, &libauth.ParsedClaims{Subject: signerUUID.String(), TenantID: tid.String(), Roles: []string{"project-manager"}, ExpireAt: time.Now().Add(time.Minute)})
	envID := completeEnvelope(t, pm, tid, docID, signerUUID)
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM document_verify_link WHERE envelope_id=$1", envID)
	})

	links := store.NewVerifyLinks(p)
	raw, hash, err := store.NewVerifyToken()
	if err != nil {
		t.Fatal(err)
	}
	envUUID := uuid.MustParse(envID)
	if _, err := links.Create(context.Background(), tid, envUUID, hash, nil, nil); err != nil {
		t.Fatal(err)
	}

	// Store-level resolve with no tenant GUC on the connection.
	got, err := links.ResolveByTokenHash(context.Background(), store.HashVerifyToken(raw))
	if err != nil {
		t.Fatalf("resolve without GUC: %v", err)
	}
	if got.TenantID != tid || got.EnvelopeID != envUUID {
		t.Fatalf("resolved wrong row: %+v", got)
	}

	// Expired link → public 404 (service-level filtering).
	past := time.Now().UTC().Add(-time.Hour)
	rawExp, hashExp, _ := store.NewVerifyToken()
	if _, err := links.Create(context.Background(), tid, envUUID, hashExp, nil, &past); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/public/verify/"+rawExp, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expired token: want 404 got %d %s", rec.Code, rec.Body.String())
	}
}
