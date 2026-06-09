package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	libauth "github.com/pmplatform/libs/go/auth"
	libpolicy "github.com/pmplatform/libs/policy"

	"github.com/pmplatform/services/accounting-svc/internal/api"
	"github.com/pmplatform/services/accounting-svc/internal/service"
	"github.com/pmplatform/services/accounting-svc/internal/store"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	if err := p.Ping(context.Background()); err != nil {
		p.Close()
		t.Skipf("postgres ping failed: %v", err)
	}
	t.Cleanup(p.Close)
	return p
}

func seedTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1,$2,$3)`,
		tid, "acct-api-"+tid.String()[:8], "Acct API Test")
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	t.Cleanup(func() { _, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id=$1`, tid) })
	return tid
}

func newHandler(t *testing.T, p *pgxpool.Pool, tid uuid.UUID, roles ...string) http.Handler {
	t.Helper()
	if len(roles) == 0 {
		roles = []string{"tenant-admin"}
	}
	svc := service.New(
		store.NewAccountStore(p),
		store.NewJournalEntryStore(p),
		store.NewInvoiceStore(p),
		store.NewBudgetStore(p),
	)
	ps, err := libpolicy.LoadShared()
	if err != nil {
		t.Fatal(err)
	}
	router := api.NewRouter(svc, &libpolicy.Adapter{Policies: ps})
	claims := &libauth.ParsedClaims{
		Subject:  uuid.NewString(),
		TenantID: tid.String(),
		Roles:    roles,
		ExpireAt: time.Now().Add(5 * time.Minute),
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Header.Set("X-Tenant-Id", tid.String())
		router.ServeHTTP(w, r.WithContext(libauth.WithClaims(r.Context(), claims)))
	})
}

func do(t *testing.T, h http.Handler, method, path string, body any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var rdr *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	} else {
		rdr = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var out map[string]any
	if rec.Body.Len() > 0 {
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
	}
	return rec, out
}

func TestAccountingLifecycle_FullHTTP(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	h := newHandler(t, p, tid)

	// ── 1. Account CRUD for each type ──
	accIDs := map[string]string{}
	for _, ty := range []string{"asset", "liability", "equity", "revenue", "expense"} {
		rec, out := do(t, h, http.MethodPost, "/v1/accounts", map[string]any{
			"code": ty[:3] + "-" + uuid.NewString()[:6], "name": ty + " acct", "account_type": ty,
		})
		if rec.Code != 201 {
			t.Fatalf("create %s account: want 201 got %d: %s", ty, rec.Code, rec.Body.String())
		}
		if out["AccountType"] != ty {
			t.Errorf("account_type round-trip: got %v want %s", out["AccountType"], ty)
		}
		accIDs[ty] = out["ID"].(string)
	}
	// update + version + delete
	rec, out := do(t, h, http.MethodPatch, "/v1/accounts/"+accIDs["expense"], map[string]any{"name": "renamed", "version": 1})
	if rec.Code != 200 || out["Name"] != "renamed" {
		t.Fatalf("update account: got %d %v", rec.Code, out)
	}
	rec, _ = do(t, h, http.MethodDelete, "/v1/accounts/"+accIDs["expense"]+"?version=2", nil)
	if rec.Code != 204 {
		t.Fatalf("delete account ?version=2: want 204 got %d", rec.Code)
	}

	// ── 2. Balanced JE → post 200 ──
	_, je := do(t, h, http.MethodPost, "/v1/journal-entries", map[string]any{"ref_no": "JE-OK-" + uuid.NewString()[:6], "memo": "balanced"})
	jeID := je["ID"].(string)
	do(t, h, http.MethodPost, "/v1/journal-entries/"+jeID+"/lines", map[string]any{"account_id": accIDs["asset"], "debit": 1000.50, "credit": 0, "line_no": 1})
	do(t, h, http.MethodPost, "/v1/journal-entries/"+jeID+"/lines", map[string]any{"account_id": accIDs["revenue"], "debit": 0, "credit": 1000.50, "line_no": 2})
	rec, out = do(t, h, http.MethodPost, "/v1/journal-entries/"+jeID+"/post", map[string]any{"version": 1})
	if rec.Code != 200 {
		t.Fatalf("post balanced JE: want 200 got %d: %s", rec.Code, rec.Body.String())
	}
	if out["Status"] != "posted" {
		t.Errorf("balanced JE status: got %v want posted", out["Status"])
	}

	// ── 3. Imbalanced JE → post 400 ──
	_, je2 := do(t, h, http.MethodPost, "/v1/journal-entries", map[string]any{"ref_no": "JE-BAD-" + uuid.NewString()[:6], "memo": "imbalanced"})
	je2ID := je2["ID"].(string)
	do(t, h, http.MethodPost, "/v1/journal-entries/"+je2ID+"/lines", map[string]any{"account_id": accIDs["asset"], "debit": 1000, "credit": 0, "line_no": 1})
	do(t, h, http.MethodPost, "/v1/journal-entries/"+je2ID+"/lines", map[string]any{"account_id": accIDs["revenue"], "debit": 0, "credit": 900, "line_no": 2})
	rec, _ = do(t, h, http.MethodPost, "/v1/journal-entries/"+je2ID+"/post", map[string]any{"version": 1})
	if rec.Code != 400 {
		t.Fatalf("post imbalanced JE: want 400 got %d: %s", rec.Code, rec.Body.String())
	}

	// ── 4. Trial balance: list posted, lines populated, sum d == sum c ──
	rec, out = do(t, h, http.MethodGet, "/v1/journal-entries?status=posted&limit=500", nil)
	if rec.Code != 200 {
		t.Fatalf("list posted: %d", rec.Code)
	}
	items, _ := out["items"].([]any)
	var totalDebit, totalCredit float64
	linesSeen := 0
	for _, it := range items {
		e := it.(map[string]any)
		// JournalEntry.Lines carries json tag "lines"; line debit/credit
		// have no tag so serialize PascalCase.
		lines, _ := e["lines"].([]any)
		for _, l := range lines {
			lm := l.(map[string]any)
			linesSeen++
			totalDebit += toF(lm["Debit"])
			totalCredit += toF(lm["Credit"])
		}
	}
	if linesSeen == 0 {
		t.Fatalf("trial balance: list returned no lines (List must populate Lines)")
	}
	if d := totalDebit - totalCredit; d > 0.005 || d < -0.005 {
		t.Errorf("trial balance does not net to zero: debits=%.4f credits=%.4f", totalDebit, totalCredit)
	}

	// ── 5. Invoice AR + AP create + list ──
	cp := uuid.NewString()
	for _, ty := range []string{"ar", "ap"} {
		rec, out = do(t, h, http.MethodPost, "/v1/invoices", map[string]any{
			"inv_no": ty + "-" + uuid.NewString()[:6], "inv_type": ty, "counterparty_id": cp,
			"amount": 5000.25, "due_date": "2026-01-01",
		})
		if rec.Code != 201 {
			t.Fatalf("create %s invoice: want 201 got %d: %s", ty, rec.Code, rec.Body.String())
		}
		if out["InvType"] != ty {
			t.Errorf("inv_type round-trip: got %v want %s", out["InvType"], ty)
		}
		if toF(out["Amount"]) != 5000.25 {
			t.Errorf("amount precision: got %v want 5000.25", out["Amount"])
		}
		// lifecycle: draft → issued
		invID := out["ID"].(string)
		rec, out = do(t, h, http.MethodPatch, "/v1/invoices/"+invID, map[string]any{"status": "issued", "version": 1})
		if rec.Code != 200 || out["Status"] != "issued" {
			t.Errorf("invoice issue: got %d status=%v", rec.Code, out["Status"])
		}
	}
	rec, out = do(t, h, http.MethodGet, "/v1/invoices?type=ar", nil)
	if rec.Code != 200 || len(out["items"].([]any)) < 1 {
		t.Errorf("list AR invoices: %d", rec.Code)
	}

	// ── 6. Budget set + list round-trip ──
	rec, out = do(t, h, http.MethodPost, "/v1/budgets", map[string]any{"account_id": accIDs["revenue"], "amount": 9999.99})
	if rec.Code != 200 {
		t.Fatalf("set budget: want 200 got %d: %s", rec.Code, rec.Body.String())
	}
	rec, out = do(t, h, http.MethodGet, "/v1/budgets", nil)
	bItems, _ := out["items"].([]any)
	if rec.Code != 200 || len(bItems) != 1 {
		t.Fatalf("list budgets: %d items=%d", rec.Code, len(bItems))
	}
	if toF(bItems[0].(map[string]any)["Amount"]) != 9999.99 {
		t.Errorf("budget amount round-trip: got %v", bItems[0].(map[string]any)["Amount"])
	}
}

func TestAccounting_CedarDeniesUnprivilegedRole(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	// quality-engineer has no accounting permits in the shared bundle.
	h := newHandler(t, p, tid, "quality-engineer")
	rec, _ := do(t, h, http.MethodPost, "/v1/accounts", map[string]any{"code": "X", "name": "x", "account_type": "asset"})
	if rec.Code != 403 {
		t.Fatalf("expected 403 for quality-engineer creating account, got %d", rec.Code)
	}
}

func toF(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case json.Number:
		f, _ := n.Float64()
		return f
	default:
		return 0
	}
}
