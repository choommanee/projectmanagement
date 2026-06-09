package store_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/sales-svc/internal/domain"
	"github.com/pmplatform/services/sales-svc/internal/store"
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
		tid, "test-sales-"+tid.String()[:8], "Test Sales "+tid.String()[:8])
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	t.Cleanup(func() { _, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tid) })
	return tid
}

func seedCustomer(t *testing.T, p *pgxpool.Pool, tid uuid.UUID) uuid.UUID {
	t.Helper()
	cs := store.NewCustomerStore(p)
	c := &domain.Customer{TenantID: tid, Code: "C-" + tid.String()[:6], Name: "Cust", Active: true}
	if err := cs.Create(context.Background(), c); err != nil {
		t.Fatalf("seed customer: %v", err)
	}
	return c.ID
}

func TestSalesOrder_AutoNumberAndDelete(t *testing.T) {
	ctx := context.Background()
	p := testPool(t)
	tid := seedTenant(t, p)
	cid := seedCustomer(t, p, tid)
	sos := store.NewSalesOrderStore(p)

	so := &domain.SalesOrder{TenantID: tid, CustomerID: cid, Status: domain.SOStatusDraft, CreatedBy: uuid.New()}
	if err := sos.Create(ctx, so); err != nil {
		t.Fatalf("create so: %v", err)
	}
	if !strings.HasPrefix(so.SONumber, "SO-") {
		t.Errorf("so_number = %q, want SO- prefix", so.SONumber)
	}
	if err := sos.Delete(ctx, tid, so.ID); err != nil {
		t.Fatalf("delete so: %v", err)
	}
	if _, err := sos.GetByID(ctx, tid, so.ID); err != domain.ErrNotFound {
		t.Errorf("expected ErrNotFound after delete, got %v", err)
	}
	if err := sos.Delete(ctx, tid, so.ID); err != domain.ErrNotFound {
		t.Errorf("expected ErrNotFound on re-delete, got %v", err)
	}
}

func TestSalesInvoice_CodeGenAndDelete(t *testing.T) {
	ctx := context.Background()
	p := testPool(t)
	tid := seedTenant(t, p)
	cid := seedCustomer(t, p, tid)
	invs := store.NewSalesInvoiceStore(p)

	inv := &domain.SalesInvoice{TenantID: tid, CustomerID: cid, Subtotal: 100, Tax: 7, Total: 107}
	if err := invs.Create(ctx, inv); err != nil {
		t.Fatalf("create invoice: %v", err)
	}
	if !strings.HasPrefix(inv.Code, "INV-") {
		t.Errorf("code = %q, want INV- prefix", inv.Code)
	}
	if err := invs.Delete(ctx, tid, inv.ID); err != nil {
		t.Fatalf("delete invoice: %v", err)
	}
	if _, err := invs.GetByID(ctx, tid, inv.ID); err != domain.ErrNotFound {
		t.Errorf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestQuotation_Delete(t *testing.T) {
	ctx := context.Background()
	p := testPool(t)
	tid := seedTenant(t, p)
	cid := seedCustomer(t, p, tid)
	qs := store.NewQuotationStore(p)

	q := &domain.Quotation{TenantID: tid, CustomerID: cid, Title: "Q1", TotalAmount: 500}
	if err := qs.Create(ctx, q); err != nil {
		t.Fatalf("create quotation: %v", err)
	}
	if err := qs.Delete(ctx, tid, q.ID); err != nil {
		t.Fatalf("delete quotation: %v", err)
	}
	if _, err := qs.GetByID(ctx, tid, q.ID); err != domain.ErrNotFound {
		t.Errorf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestShipment_UpdateStatusAndDelete(t *testing.T) {
	ctx := context.Background()
	p := testPool(t)
	tid := seedTenant(t, p)
	cid := seedCustomer(t, p, tid)
	ss := store.NewShipmentStore(p)

	s := &domain.Shipment{TenantID: tid, CustomerID: &cid, Code: "SH-1"}
	if err := ss.Create(ctx, s); err != nil {
		t.Fatalf("create shipment: %v", err)
	}
	got, err := ss.UpdateStatus(ctx, tid, s.ID, domain.ShipmentShipped)
	if err != nil {
		t.Fatalf("update status: %v", err)
	}
	if got.Status != domain.ShipmentShipped {
		t.Errorf("status = %q, want shipped", got.Status)
	}
	if err := ss.Delete(ctx, tid, s.ID); err != nil {
		t.Fatalf("delete shipment: %v", err)
	}
	if _, err := ss.GetByID(ctx, tid, s.ID); err != domain.ErrNotFound {
		t.Errorf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestOpportunity_Delete(t *testing.T) {
	ctx := context.Background()
	p := testPool(t)
	tid := seedTenant(t, p)
	cid := seedCustomer(t, p, tid)
	os := store.NewOpportunityStore(p)

	o := &domain.Opportunity{TenantID: tid, CustomerID: cid, Title: "Lead"}
	if err := os.Create(ctx, o); err != nil {
		t.Fatalf("create opportunity: %v", err)
	}
	if err := os.Delete(ctx, tid, o.ID); err != nil {
		t.Fatalf("delete opportunity: %v", err)
	}
	if _, err := os.GetByID(ctx, tid, o.ID); err != domain.ErrNotFound {
		t.Errorf("expected ErrNotFound after delete, got %v", err)
	}
}

func TestInvoiceTotalsFromSOLines(t *testing.T) {
	ctx := context.Background()
	p := testPool(t)
	tid := seedTenant(t, p)
	cid := seedCustomer(t, p, tid)
	sos := store.NewSalesOrderStore(p)

	so := &domain.SalesOrder{TenantID: tid, CustomerID: cid, Status: domain.SOStatusDraft, CreatedBy: uuid.New()}
	if err := sos.Create(ctx, so); err != nil {
		t.Fatalf("create so: %v", err)
	}
	for _, l := range []*domain.SOLine{
		{TenantID: tid, SOID: so.ID, ItemDesc: "A", LineNo: 1, QtyOrdered: 10, UnitPrice: 100},
		{TenantID: tid, SOID: so.ID, ItemDesc: "B", LineNo: 2, QtyOrdered: 2, UnitPrice: 50},
	} {
		if err := sos.AddLine(ctx, l); err != nil {
			t.Fatalf("add line: %v", err)
		}
	}
	got, err := sos.GetByID(ctx, tid, so.ID)
	if err != nil {
		t.Fatalf("get so: %v", err)
	}
	var subtotal float64
	for _, l := range got.Lines {
		subtotal += l.QtyOrdered * l.UnitPrice
	}
	if subtotal != 1100 {
		t.Errorf("subtotal = %v, want 1100", subtotal)
	}
}
