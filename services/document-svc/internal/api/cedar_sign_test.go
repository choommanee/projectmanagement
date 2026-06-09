package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	libauth "github.com/pmplatform/libs/go/auth"
	libpolicy "github.com/pmplatform/libs/policy"

	"github.com/pmplatform/services/document-svc/internal/api"
	"github.com/pmplatform/services/document-svc/internal/service"
	"github.com/pmplatform/services/document-svc/internal/store"
)

func seedSignDoc(t *testing.T, p *pgxpool.Pool, tid, pid uuid.UUID) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	wsID := uuid.New()
	docID := uuid.New()
	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, e := tx.Exec(ctx, "SET LOCAL app.current_tenant = '"+tid.String()+"'"); e != nil {
		t.Fatal(e)
	}
	if _, e := tx.Exec(ctx,
		`INSERT INTO workspace(id,tenant_id,project_id,kind,name) VALUES ($1,$2,$3,'ba','WS')`, wsID, tid, pid); e != nil {
		t.Fatal(e)
	}
	if _, e := tx.Exec(ctx,
		`INSERT INTO document(id,tenant_id,workspace_id,project_id,type,title,body,version) VALUES ($1,$2,$3,$4,'brd','D','{"type":"doc"}'::jsonb,1)`,
		docID, tid, wsID, pid); e != nil {
		t.Fatal(e)
	}
	if e := tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		p.Exec(ctx, "DELETE FROM document WHERE id=$1", docID)
		p.Exec(ctx, "DELETE FROM workspace WHERE id=$1", wsID)
	})
	return docID
}

func signRouter(p *pgxpool.Pool, authz libauth.Authorizer) http.Handler {
	svc := service.New(store.NewWorkspaces(p), store.NewDocuments(p), store.NewComments(p), store.NewTemplates(p)).
		WithSignatures(store.NewSignatures(p))
	return api.NewRouterWithLoader(svc, authz, api.NewCedarLoader(p))
}

func TestCedarGatesEnvelopeCreate_AllowsPM_Denies403MfgOperator(t *testing.T) {
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

	body, _ := json.Marshal(map[string]any{
		"signing_order": "parallel",
		"signers":       []map[string]any{{"signer_id": uuid.New().String(), "email": "a@x.com"}},
	})

	// Allowed: project-manager
	pm := withClaims(router, &libauth.ParsedClaims{Subject: uuid.New().String(), TenantID: tid.String(), Roles: []string{"project-manager"}, ExpireAt: time.Now().Add(time.Minute)})
	req := httptest.NewRequest(http.MethodPost, "/v1/documents/"+docID.String()+"/sign-envelopes", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-Id", tid.String())
	rec := httptest.NewRecorder()
	pm.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("PM create envelope want 201 got %d: %s", rec.Code, rec.Body.String())
	}

	// Denied: mfg-operator
	op := withClaims(router, &libauth.ParsedClaims{Subject: uuid.New().String(), TenantID: tid.String(), Roles: []string{"mfg-operator"}, ExpireAt: time.Now().Add(time.Minute)})
	req2 := httptest.NewRequest(http.MethodPost, "/v1/documents/"+docID.String()+"/sign-envelopes", bytes.NewReader(body))
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("X-Tenant-Id", tid.String())
	rec2 := httptest.NewRecorder()
	op.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusForbidden {
		t.Fatalf("mfg-operator create envelope want 403 got %d: %s", rec2.Code, rec2.Body.String())
	}
}

func TestEnvelopeHTTPLifecycleAndCertificate(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()
	tid := seedCedarTenant(t, p)
	pid := seedCedarProject(t, p, tid)
	docID := seedSignDoc(t, p, tid, pid)

	ps, _ := libpolicy.LoadShared()
	authz := &libpolicy.Adapter{Policies: ps}
	router := signRouter(p, authz)
	signerUUID := uuid.New()
	h := withClaims(router, &libauth.ParsedClaims{Subject: signerUUID.String(), TenantID: tid.String(), Roles: []string{"project-manager"}, ExpireAt: time.Now().Add(time.Minute)})

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
		req.Header.Set("X-Forwarded-For", "203.0.113.42, 10.0.0.1")
		req.Header.Set("User-Agent", "TestAgent/1.0")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	// create
	rec := do(http.MethodPost, "/v1/documents/"+docID.String()+"/sign-envelopes", map[string]any{
		"signing_order": "parallel",
		"signers":       []map[string]any{{"signer_id": signerUUID.String(), "name": "Eve", "email": "e@x.com"}},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var env struct {
		ID      string `json:"id"`
		Signers []struct {
			ID string `json:"id"`
		} `json:"signers"`
	}
	json.Unmarshal(rec.Body.Bytes(), &env)
	if env.ID == "" || len(env.Signers) != 1 {
		t.Fatalf("bad envelope payload: %s", rec.Body.String())
	}

	// send
	if rec := do(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/send", nil); rec.Code != 200 {
		t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
	}

	// view
	if rec := do(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/signers/"+env.Signers[0].ID+"/view", nil); rec.Code != 200 {
		t.Fatalf("view: %d %s", rec.Code, rec.Body.String())
	}

	// sign (with consent)
	rec = do(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/signers/"+env.Signers[0].ID+"/sign", map[string]any{
		"consent": true, "typed_name": "Eve", "auth_method": "typed_name",
	})
	if rec.Code != 200 {
		t.Fatalf("sign: %d %s", rec.Code, rec.Body.String())
	}
	var signResp struct {
		Completed bool `json:"completed"`
	}
	json.Unmarshal(rec.Body.Bytes(), &signResp)
	if !signResp.Completed {
		t.Fatal("expected completed=true")
	}

	// verify
	rec = do(http.MethodGet, "/v1/sign-envelopes/"+env.ID+"/verify", nil)
	if rec.Code != 200 {
		t.Fatalf("verify: %d %s", rec.Code, rec.Body.String())
	}
	var vr struct {
		Valid bool `json:"valid"`
	}
	json.Unmarshal(rec.Body.Bytes(), &vr)
	if !vr.Valid {
		t.Fatalf("chain not valid: %s", rec.Body.String())
	}

	// audit must contain IP from X-Forwarded-For first hop
	rec = do(http.MethodGet, "/v1/sign-envelopes/"+env.ID+"/audit", nil)
	if rec.Code != 200 {
		t.Fatalf("audit: %d", rec.Code)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("203.0.113.42")) {
		t.Fatalf("audit missing forwarded ip: %s", rec.Body.String())
	}

	// certificate is application/pdf
	rec = do(http.MethodGet, "/v1/sign-envelopes/"+env.ID+"/certificate", nil)
	if rec.Code != 200 {
		t.Fatalf("certificate: %d %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/pdf" {
		t.Fatalf("cert content-type=%q", ct)
	}
	if !bytes.HasPrefix(rec.Body.Bytes(), []byte("%PDF")) {
		t.Fatal("certificate body not a PDF")
	}

	// verify response carries hardened fields
	rec = do(http.MethodGet, "/v1/sign-envelopes/"+env.ID+"/verify", nil)
	var vr2 struct {
		Valid      bool   `json:"valid"`
		EventChain string `json:"event_chain"`
		Links      []struct {
			RecordSigValid *bool `json:"record_sig_valid"`
		} `json:"links"`
	}
	json.Unmarshal(rec.Body.Bytes(), &vr2)
	if !vr2.Valid || vr2.EventChain != "valid" {
		t.Fatalf("verify hardened: want valid+event_chain=valid, got %s", rec.Body.String())
	}
	if len(vr2.Links) != 1 || vr2.Links[0].RecordSigValid == nil || !*vr2.Links[0].RecordSigValid {
		t.Fatalf("verify hardened: want record_sig_valid=true, got %s", rec.Body.String())
	}
}

// TestCrossSignerForbidden403: signer B's JWT cannot sign (or decline) signer
// A's row — the service compares the JWT actor to the row's signer_id.
func TestCrossSignerForbidden403(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()
	tid := seedCedarTenant(t, p)
	pid := seedCedarProject(t, p, tid)
	docID := seedSignDoc(t, p, tid, pid)

	ps, _ := libpolicy.LoadShared()
	authz := &libpolicy.Adapter{Policies: ps}
	router := signRouter(p, authz)

	signerA := uuid.New()
	signerB := uuid.New()
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
			{"signer_id": signerA.String(), "name": "A", "email": "a@x.com"},
			{"signer_id": signerB.String(), "name": "B", "email": "b@x.com"},
		},
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
	}
	var env struct {
		ID      string `json:"id"`
		Signers []struct {
			ID       string `json:"id"`
			SignerID string `json:"signer_id"`
		} `json:"signers"`
	}
	json.Unmarshal(rec.Body.Bytes(), &env)
	if rec := asA(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/send", nil); rec.Code != 200 {
		t.Fatalf("send: %d %s", rec.Code, rec.Body.String())
	}
	rowA := env.Signers[0].ID // order preserved: A is index 0

	// B signs A's row → 403
	if rec := asB(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/signers/"+rowA+"/sign",
		map[string]any{"consent": true}); rec.Code != http.StatusForbidden {
		t.Fatalf("cross-sign: want 403, got %d %s", rec.Code, rec.Body.String())
	}
	// B declines A's row → 403
	if rec := asB(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/signers/"+rowA+"/decline",
		map[string]any{"reason": "no"}); rec.Code != http.StatusForbidden {
		t.Fatalf("cross-decline: want 403, got %d %s", rec.Code, rec.Body.String())
	}
	// A signs A's row → 200
	if rec := asA(http.MethodPost, "/v1/sign-envelopes/"+env.ID+"/signers/"+rowA+"/sign",
		map[string]any{"consent": true}); rec.Code != 200 {
		t.Fatalf("self-sign: want 200, got %d %s", rec.Code, rec.Body.String())
	}
}

// TestLegacySignatureShimRemoved: the ungated /v1/documents/{id}/signatures*
// routes were deleted — they must 404/405 even for authenticated callers.
func TestLegacySignatureShimRemoved(t *testing.T) {
	p := cedarTestPool(t)
	defer p.Close()
	tid := seedCedarTenant(t, p)
	pid := seedCedarProject(t, p, tid)
	docID := seedSignDoc(t, p, tid, pid)

	ps, _ := libpolicy.LoadShared()
	authz := &libpolicy.Adapter{Policies: ps}
	router := signRouter(p, authz)
	h := withClaims(router, &libauth.ParsedClaims{Subject: uuid.NewString(), TenantID: tid.String(), Roles: []string{"project-manager"}, ExpireAt: time.Now().Add(time.Minute)})

	for _, tc := range []struct{ method, path string }{
		{http.MethodGet, "/v1/documents/" + docID.String() + "/signatures"},
		{http.MethodPost, "/v1/documents/" + docID.String() + "/signatures"},
		{http.MethodPost, "/v1/documents/" + docID.String() + "/signatures/" + uuid.NewString() + "/sign"},
		{http.MethodPost, "/v1/documents/" + docID.String() + "/signatures/" + uuid.NewString() + "/decline"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, bytes.NewReader([]byte(`{}`)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Tenant-Id", tid.String())
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s %s: want 404/405, got %d %s", tc.method, tc.path, rec.Code, rec.Body.String())
		}
	}
}
