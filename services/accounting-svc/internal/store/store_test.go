package store_test

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/accounting-svc/internal/domain"
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
		t.Skipf("no test database: %v", err)
	}
	if err := p.Ping(context.Background()); err != nil {
		p.Close()
		t.Skipf("no test database: %v", err)
	}
	t.Cleanup(p.Close)
	return p
}

func seedTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, $2, $3)`,
		tid, "test-acct-"+tid.String()[:8], "Test Acct "+tid.String()[:8])
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	t.Cleanup(func() { _, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tid) })
	return tid
}

func TestAccount_CreateReadDelete(t *testing.T) {
	ctx := context.Background()
	p := testPool(t)
	tid := seedTenant(t, p)
	as := store.NewAccountStore(p)

	a := &domain.ChartOfAccount{TenantID: tid, Code: "1000", Name: "Cash", AccountType: "asset", Currency: "THB", Active: true}
	if err := as.Create(ctx, a); err != nil {
		t.Fatalf("create account: %v", err)
	}
	got, err := as.GetByID(ctx, tid, a.ID)
	if err != nil {
		t.Fatalf("get account: %v", err)
	}
	if got.AccountType != "asset" {
		t.Errorf("account_type = %q, want asset", got.AccountType)
	}
	if err := as.Delete(ctx, tid, a.ID, got.Version); err != nil {
		t.Fatalf("delete account: %v", err)
	}
	if _, err := as.GetByID(ctx, tid, a.ID); err != domain.ErrNotFound {
		t.Errorf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestInvoice_CounterpartyAndTypeRoundTrip(t *testing.T) {
	ctx := context.Background()
	p := testPool(t)
	tid := seedTenant(t, p)
	is := store.NewInvoiceStore(p)

	cp := uuid.New()
	inv := &domain.Invoice{
		TenantID: tid, InvNo: "AR-1", InvType: domain.InvTypeAR,
		CounterpartyID: &cp, Amount: 1200, Currency: "THB", CreatedBy: uuid.New(),
	}
	if err := is.Create(ctx, inv); err != nil {
		t.Fatalf("create invoice: %v", err)
	}
	got, err := is.GetByID(ctx, tid, inv.ID)
	if err != nil {
		t.Fatalf("get invoice: %v", err)
	}
	if got.InvType != domain.InvTypeAR {
		t.Errorf("inv_type = %q, want ar", got.InvType)
	}
	if got.CounterpartyID == nil || *got.CounterpartyID != cp {
		t.Errorf("counterparty_id round-trip failed: %v", got.CounterpartyID)
	}
	if err := is.Delete(ctx, tid, inv.ID, got.Version); err != nil {
		t.Fatalf("delete invoice: %v", err)
	}
}

func TestJournalLine_DescriptionRoundTrip(t *testing.T) {
	ctx := context.Background()
	p := testPool(t)
	tid := seedTenant(t, p)
	as := store.NewAccountStore(p)
	js := store.NewJournalEntryStore(p)

	a := &domain.ChartOfAccount{TenantID: tid, Code: "2000", Name: "AP", AccountType: "liability", Currency: "THB", Active: true}
	if err := as.Create(ctx, a); err != nil {
		t.Fatalf("create account: %v", err)
	}
	e := &domain.JournalEntry{TenantID: tid, RefNo: "JE-1", Memo: "m", CreatedBy: uuid.New()}
	if err := js.Create(ctx, e); err != nil {
		t.Fatalf("create JE: %v", err)
	}
	line := &domain.JournalLine{TenantID: tid, EntryID: e.ID, AccountID: a.ID, Debit: 250, Description: "cash in", LineNo: 1}
	if err := js.AddLine(ctx, line); err != nil {
		t.Fatalf("add line: %v", err)
	}
	got, err := js.GetByID(ctx, tid, e.ID)
	if err != nil {
		t.Fatalf("get JE: %v", err)
	}
	if len(got.Lines) != 1 || got.Lines[0].Description != "cash in" {
		t.Errorf("description round-trip failed: %+v", got.Lines)
	}
}

// helper: create two accounts + a JE with the supplied debit/credit pairs.
func seedJE(t *testing.T, ctx context.Context, p *pgxpool.Pool, tid uuid.UUID, pairs [][2]float64) (*store.JournalEntryStore, *domain.JournalEntry) {
	t.Helper()
	as := store.NewAccountStore(p)
	js := store.NewJournalEntryStore(p)
	debitAcct := &domain.ChartOfAccount{TenantID: tid, Code: "D" + uuid.NewString()[:6], Name: "Dr", AccountType: "asset", Currency: "THB", Active: true}
	creditAcct := &domain.ChartOfAccount{TenantID: tid, Code: "C" + uuid.NewString()[:6], Name: "Cr", AccountType: "revenue", Currency: "THB", Active: true}
	if err := as.Create(ctx, debitAcct); err != nil {
		t.Fatalf("create dr account: %v", err)
	}
	if err := as.Create(ctx, creditAcct); err != nil {
		t.Fatalf("create cr account: %v", err)
	}
	e := &domain.JournalEntry{TenantID: tid, RefNo: "JE-" + uuid.NewString()[:8], Memo: "m", CreatedBy: uuid.New()}
	if err := js.Create(ctx, e); err != nil {
		t.Fatalf("create JE: %v", err)
	}
	for i, pr := range pairs {
		acct := debitAcct
		if pr[1] > 0 {
			acct = creditAcct
		}
		if err := js.AddLine(ctx, &domain.JournalLine{TenantID: tid, EntryID: e.ID, AccountID: acct.ID, Debit: pr[0], Credit: pr[1], LineNo: i + 1}); err != nil {
			t.Fatalf("add line: %v", err)
		}
	}
	return js, e
}

func TestJournalEntry_PostRejectsImbalance(t *testing.T) {
	ctx := context.Background()
	p := testPool(t)
	tid := seedTenant(t, p)
	js, e := seedJE(t, ctx, p, tid, [][2]float64{{100, 0}, {0, 90}})

	if _, err := js.Post(ctx, tid, e.ID, e.Version); !errorsIsInvalid(err) {
		t.Fatalf("expected ErrInvalidInput for imbalanced JE, got %v", err)
	}
	// entry must remain draft
	got, err := js.GetByID(ctx, tid, e.ID)
	if err != nil {
		t.Fatalf("get JE: %v", err)
	}
	if got.Status != domain.JEStatusDraft {
		t.Errorf("imbalanced JE should stay draft, got %q", got.Status)
	}
}

func TestJournalEntry_PostBalancedSucceeds(t *testing.T) {
	ctx := context.Background()
	p := testPool(t)
	tid := seedTenant(t, p)
	js, e := seedJE(t, ctx, p, tid, [][2]float64{{100.25, 0}, {0, 100.25}})

	posted, err := js.Post(ctx, tid, e.ID, e.Version)
	if err != nil {
		t.Fatalf("post balanced JE: %v", err)
	}
	if posted.Status != domain.JEStatusPosted {
		t.Errorf("balanced JE should be posted, got %q", posted.Status)
	}
	if posted.PostedAt == nil {
		t.Errorf("posted_at should be set")
	}
}

func TestJournalEntry_PostRejectsEmpty(t *testing.T) {
	ctx := context.Background()
	p := testPool(t)
	tid := seedTenant(t, p)
	js := store.NewJournalEntryStore(p)
	e := &domain.JournalEntry{TenantID: tid, RefNo: "JE-EMPTY", Memo: "m", CreatedBy: uuid.New()}
	if err := js.Create(ctx, e); err != nil {
		t.Fatalf("create JE: %v", err)
	}
	if _, err := js.Post(ctx, tid, e.ID, e.Version); !errorsIsInvalid(err) {
		t.Fatalf("expected ErrInvalidInput for empty JE, got %v", err)
	}
}

func TestJournalEntry_ListPopulatesLines(t *testing.T) {
	ctx := context.Background()
	p := testPool(t)
	tid := seedTenant(t, p)
	js, e := seedJE(t, ctx, p, tid, [][2]float64{{42, 0}, {0, 42}})
	if _, err := js.Post(ctx, tid, e.ID, e.Version); err != nil {
		t.Fatalf("post: %v", err)
	}
	items, total, err := js.List(ctx, tid, store.ListJEOpts{Status: "posted"})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if total < 1 {
		t.Fatalf("expected at least 1 posted entry")
	}
	var found *domain.JournalEntry
	for _, it := range items {
		if it.ID == e.ID {
			found = it
		}
	}
	if found == nil {
		t.Fatalf("posted entry not in list")
	}
	if len(found.Lines) != 2 {
		t.Errorf("List should populate lines; got %d lines, want 2", len(found.Lines))
	}
	var d, c float64
	for _, l := range found.Lines {
		d += l.Debit
		c += l.Credit
	}
	if d != 42 || c != 42 {
		t.Errorf("line totals d=%.2f c=%.2f, want 42/42", d, c)
	}
}

func TestBudget_UpsertRoundTrip(t *testing.T) {
	ctx := context.Background()
	p := testPool(t)
	tid := seedTenant(t, p)
	as := store.NewAccountStore(p)
	bs := store.NewBudgetStore(p)

	a := &domain.ChartOfAccount{TenantID: tid, Code: "BUD-1", Name: "Expenses", AccountType: "expense", Currency: "THB", Active: true}
	if err := as.Create(ctx, a); err != nil {
		t.Fatalf("create account: %v", err)
	}
	if _, err := bs.Upsert(ctx, tid, a.ID, 5000.50); err != nil {
		t.Fatalf("upsert budget: %v", err)
	}
	// update same account → replace, not duplicate
	if _, err := bs.Upsert(ctx, tid, a.ID, 7500.75); err != nil {
		t.Fatalf("update budget: %v", err)
	}
	items, err := bs.List(ctx, tid)
	if err != nil {
		t.Fatalf("list budgets: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 budget row, got %d", len(items))
	}
	if items[0].Amount != 7500.75 {
		t.Errorf("budget amount = %.2f, want 7500.75", items[0].Amount)
	}
}

func errorsIsInvalid(err error) bool {
	return errors.Is(err, domain.ErrInvalidInput)
}
