package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
	"github.com/pmplatform/services/mfg-svc/internal/store"
)

// seedSalesOrder inserts a customer + sales_order in the shared platform DB and
// returns the sales_order id. sales_order is owned by sales-svc but lives in the
// same `platform` database, which is exactly why a real FK is feasible.
func seedSalesOrder(t *testing.T, p *pgxpool.Pool, tid uuid.UUID, soNumber string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	custID := uuid.New()
	if _, err := p.Exec(ctx,
		`INSERT INTO customer(id, tenant_id, code, name) VALUES ($1,$2,$3,$4)`,
		custID, tid, "CUST-"+soNumber, "Customer "+soNumber); err != nil {
		t.Fatalf("seed customer: %v", err)
	}
	soID := uuid.New()
	if _, err := p.Exec(ctx,
		`INSERT INTO sales_order(id, tenant_id, so_number, customer_id, created_by)
		 VALUES ($1,$2,$3,$4,$5)`,
		soID, tid, soNumber, custID, uuid.New()); err != nil {
		t.Fatalf("seed sales_order: %v", err)
	}
	return soID
}

func TestWorkOrder_SourceSoID_RoundTripAndSetNull(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	items := store.NewItems(p)
	boms := store.NewBOMs(p)
	wos := store.NewWorkOrders(p, boms)

	item, _ := seedItemAndUOM(t, p, items, tid, "WO-SO-001", domain.ItemTypeFinished)
	soID := seedSalesOrder(t, p, tid, "SO-WO-LINK-001")

	wo := &domain.WorkOrder{
		ID: uuid.New(), TenantID: tid, Code: "WO-SO-LINK-001", ItemID: item.ID,
		Qty: 5, Status: domain.WOStatusPlanned, Priority: domain.WOPriorityMed,
		SourceSoID: &soID, Version: 1,
	}
	if err := wos.Create(context.Background(), wo); err != nil {
		t.Fatalf("create WO: %v", err)
	}

	// Round-trip: the FK survives a fetch.
	got, err := wos.GetByID(context.Background(), tid, wo.ID)
	if err != nil {
		t.Fatalf("get WO: %v", err)
	}
	if got.SourceSoID == nil || *got.SourceSoID != soID {
		t.Fatalf("SourceSoID = %v, want %v", got.SourceSoID, soID)
	}

	// Filter by source_so_id returns the linked WO.
	listed, _, err := wos.List(context.Background(), tid, store.ListWOOpts{SourceSoID: &soID})
	if err != nil {
		t.Fatalf("list by source_so_id: %v", err)
	}
	if len(listed) != 1 || listed[0].ID != wo.ID {
		t.Fatalf("list by source_so_id = %d rows, want 1 (the linked WO)", len(listed))
	}

	// Clear via Update (null patch).
	got.SourceSoID = nil
	if err := wos.Update(context.Background(), got); err != nil {
		t.Fatalf("update clear: %v", err)
	}
	cleared, err := wos.GetByID(context.Background(), tid, wo.ID)
	if err != nil {
		t.Fatalf("get after clear: %v", err)
	}
	if cleared.SourceSoID != nil {
		t.Fatalf("SourceSoID after clear = %v, want nil", cleared.SourceSoID)
	}

	// Re-link, then prove ON DELETE SET NULL: deleting the SO nulls the column
	// instead of destroying the WO.
	cleared.SourceSoID = &soID
	if err := wos.Update(context.Background(), cleared); err != nil {
		t.Fatalf("re-link: %v", err)
	}
	if _, err := p.Exec(context.Background(), `DELETE FROM sales_order WHERE id = $1`, soID); err != nil {
		t.Fatalf("delete SO: %v", err)
	}
	survivor, err := wos.GetByID(context.Background(), tid, wo.ID)
	if err != nil {
		t.Fatalf("WO must survive SO delete: %v", err)
	}
	if survivor.SourceSoID != nil {
		t.Fatalf("ON DELETE SET NULL failed: SourceSoID = %v, want nil", survivor.SourceSoID)
	}
}

func TestPurchaseOrder_SourceSoID_RoundTripAndSetNull(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	suppliers := store.NewSuppliers(p)
	pos := store.NewPurchaseOrders(p)

	sup := &domain.Supplier{
		ID: uuid.New(), TenantID: tid, Code: "SUP-SO-1", Name: "Supplier SO", Active: true, Version: 1,
	}
	if err := suppliers.Create(context.Background(), sup); err != nil {
		t.Fatalf("create supplier: %v", err)
	}
	soID := seedSalesOrder(t, p, tid, "SO-PO-LINK-001")

	orderDate := time.Now()
	po := &domain.PurchaseOrder{
		ID: uuid.New(), TenantID: tid, PONumber: "PO-SO-LINK-001", SupplierID: sup.ID,
		Status: domain.PODraft, OrderDate: &orderDate, SourceSoID: &soID, CreatedBy: uuid.New(), Version: 1,
	}
	if err := pos.Create(context.Background(), po); err != nil {
		t.Fatalf("create PO: %v", err)
	}

	got, err := pos.GetByID(context.Background(), tid, po.ID)
	if err != nil {
		t.Fatalf("get PO: %v", err)
	}
	if got.SourceSoID == nil || *got.SourceSoID != soID {
		t.Fatalf("SourceSoID = %v, want %v", got.SourceSoID, soID)
	}

	listed, _, err := pos.List(context.Background(), tid, store.ListPOOpts{SourceSoID: &soID})
	if err != nil {
		t.Fatalf("list by source_so_id: %v", err)
	}
	if len(listed) != 1 || listed[0].ID != po.ID {
		t.Fatalf("list by source_so_id = %d rows, want 1", len(listed))
	}

	// Clear via Update.
	got.SourceSoID = nil
	if err := pos.Update(context.Background(), got); err != nil {
		t.Fatalf("update clear: %v", err)
	}
	cleared, err := pos.GetByID(context.Background(), tid, po.ID)
	if err != nil {
		t.Fatalf("get after clear: %v", err)
	}
	if cleared.SourceSoID != nil {
		t.Fatalf("SourceSoID after clear = %v, want nil", cleared.SourceSoID)
	}

	// Re-link and prove ON DELETE SET NULL.
	cleared.SourceSoID = &soID
	if err := pos.Update(context.Background(), cleared); err != nil {
		t.Fatalf("re-link: %v", err)
	}
	if _, err := p.Exec(context.Background(), `DELETE FROM sales_order WHERE id = $1`, soID); err != nil {
		t.Fatalf("delete SO: %v", err)
	}
	survivor, err := pos.GetByID(context.Background(), tid, po.ID)
	if err != nil {
		t.Fatalf("PO must survive SO delete: %v", err)
	}
	if survivor.SourceSoID != nil {
		t.Fatalf("ON DELETE SET NULL failed: SourceSoID = %v, want nil", survivor.SourceSoID)
	}
}
