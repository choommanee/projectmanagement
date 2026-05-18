package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
	"github.com/pmplatform/services/mfg-svc/internal/store"
)

func seedItemAndUOM(t *testing.T, p interface{ /* pgxpool */ }, items *store.Items, tid uuid.UUID, code string, typ domain.ItemType) (*domain.Item, *domain.UOM) {
	t.Helper()
	u := seedUOM(t, items, tid)
	it := &domain.Item{
		ID: uuid.New(), TenantID: tid, Code: code, Name: "Item " + code,
		Type: typ, Status: domain.ItemStatusActive, UomID: u.ID, Attrs: map[string]any{}, Version: 1,
	}
	if err := items.Create(context.Background(), it); err != nil {
		t.Fatalf("create item %s: %v", code, err)
	}
	return it, u
}

func TestWorkOrder_Create(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	items := store.NewItems(p)
	boms := store.NewBOMs(p)
	wos := store.NewWorkOrders(p, boms)

	item, _ := seedItemAndUOM(t, p, items, tid, "WO-ITEM-001", domain.ItemTypeFinished)

	wo := &domain.WorkOrder{
		ID: uuid.New(), TenantID: tid, Code: "WO-001", ItemID: item.ID,
		Qty: 10, Status: domain.WOStatusPlanned, Priority: domain.WOPriorityMed, Version: 1,
	}
	if err := wos.Create(context.Background(), wo); err != nil {
		t.Fatalf("create WO: %v", err)
	}
	got, err := wos.GetByID(context.Background(), tid, wo.ID)
	if err != nil {
		t.Fatalf("get WO: %v", err)
	}
	if got.Code != "WO-001" {
		t.Errorf("code = %q, want WO-001", got.Code)
	}
	if got.Qty != 10 {
		t.Errorf("qty = %v, want 10", got.Qty)
	}
}

func TestWorkOrder_ReleaseSnapshotsOpsAndMaterials(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	items := store.NewItems(p)
	boms := store.NewBOMs(p)
	routings := store.NewRoutings(p)
	wcs := store.NewWorkCenters(p)
	wos := store.NewWorkOrders(p, boms)

	// Create items
	fg, u := seedItemAndUOM(t, p, items, tid, "FG-R01", domain.ItemTypeAssembly)
	comp := &domain.Item{
		ID: uuid.New(), TenantID: tid, Code: "COMP-R01", Name: "Component R",
		Type: domain.ItemTypeComponent, Status: domain.ItemStatusActive, UomID: u.ID, Attrs: map[string]any{}, Version: 1,
	}
	if err := items.Create(context.Background(), comp); err != nil {
		t.Fatalf("create comp: %v", err)
	}

	// BOM: FG has 2x COMP
	hBOM := &domain.BOMHeader{TenantID: tid, ItemID: fg.ID, IsDefault: true, Status: domain.BOMStatusDraft}
	if err := boms.CreateHeader(context.Background(), hBOM); err != nil {
		t.Fatalf("bom header: %v", err)
	}
	if err := boms.AddLine(context.Background(), &domain.BOMLine{TenantID: tid, HeaderID: hBOM.ID, ChildItemID: comp.ID, Qty: 2, UomID: u.ID}); err != nil {
		t.Fatalf("bom line: %v", err)
	}
	if err := boms.MarkActive(context.Background(), tid, hBOM.ID); err != nil {
		t.Fatalf("activate bom: %v", err)
	}

	// Routing: one operation
	wc := &domain.WorkCenter{
		ID: uuid.New(), TenantID: tid, Code: "WC-REL", Name: "Release WC",
		Type: domain.WCTypeMachine, CapacityPerDayHrs: 8, Status: domain.ItemStatusActive, Version: 1,
	}
	if err := wcs.Create(context.Background(), wc); err != nil {
		t.Fatalf("create wc: %v", err)
	}
	hRT := &domain.RoutingHeader{TenantID: tid, ItemID: fg.ID, IsDefault: true, Status: domain.BOMStatusDraft}
	if err := routings.CreateHeader(context.Background(), hRT); err != nil {
		t.Fatalf("routing header: %v", err)
	}
	if err := routings.AddOperation(context.Background(), &domain.RoutingOperation{
		TenantID: tid, RoutingID: hRT.ID, OpNo: 10, WorkCenterID: wc.ID, SetupMin: 5, RunPerUnitMin: 2,
	}); err != nil {
		t.Fatalf("routing op: %v", err)
	}
	if err := routings.UpdateHeader(context.Background(), &domain.RoutingHeader{
		ID: hRT.ID, TenantID: tid, ItemID: fg.ID, IsDefault: true, Status: domain.BOMStatusActive,
	}); err != nil {
		t.Fatalf("activate routing: %v", err)
	}

	// Create and release WO
	wo := &domain.WorkOrder{
		ID: uuid.New(), TenantID: tid, Code: "WO-REL-001", ItemID: fg.ID,
		Qty: 5, Status: domain.WOStatusPlanned, Priority: domain.WOPriorityMed, Version: 1,
	}
	if err := wos.Create(context.Background(), wo); err != nil {
		t.Fatalf("create WO: %v", err)
	}
	released, err := wos.ReleaseWorkOrder(context.Background(), tid, wo.ID, 1)
	if err != nil {
		t.Fatalf("release WO: %v", err)
	}
	if released.Status != domain.WOStatusReleased {
		t.Errorf("status = %v, want released", released.Status)
	}

	// Verify operations snapshot
	ops, err := wos.ListOperations(context.Background(), tid, wo.ID)
	if err != nil {
		t.Fatalf("list ops: %v", err)
	}
	if len(ops) != 1 {
		t.Errorf("ops = %d, want 1", len(ops))
	}

	// Verify materials snapshot: COMP qty=5*2=10
	mats, err := wos.ListMaterials(context.Background(), tid, wo.ID)
	if err != nil {
		t.Fatalf("list mats: %v", err)
	}
	if len(mats) != 1 {
		t.Errorf("materials = %d, want 1", len(mats))
	}
	if mats[0].QtyRequired != 10 {
		t.Errorf("qty_required = %v, want 10 (5 WO qty * 2 BOM qty)", mats[0].QtyRequired)
	}
}

func TestWorkOrder_ListByStatus(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	items := store.NewItems(p)
	boms := store.NewBOMs(p)
	wos := store.NewWorkOrders(p, boms)

	item, _ := seedItemAndUOM(t, p, items, tid, "WO-LS-001", domain.ItemTypeFinished)

	for _, code := range []string{"WO-LS-A", "WO-LS-B"} {
		wo := &domain.WorkOrder{
			ID: uuid.New(), TenantID: tid, Code: code, ItemID: item.ID,
			Qty: 1, Status: domain.WOStatusPlanned, Priority: domain.WOPriorityLow, Version: 1,
		}
		if err := wos.Create(context.Background(), wo); err != nil {
			t.Fatalf("create %s: %v", code, err)
		}
	}

	result, total, err := wos.List(context.Background(), tid, store.ListWOOpts{Status: "planned", Limit: 100})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if total < 2 {
		t.Errorf("total = %d, want >= 2", total)
	}
	_ = result
}

func TestWorkOrder_SoftDelete(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	items := store.NewItems(p)
	boms := store.NewBOMs(p)
	wos := store.NewWorkOrders(p, boms)

	item, _ := seedItemAndUOM(t, p, items, tid, "WO-DEL-001", domain.ItemTypeFinished)
	wo := &domain.WorkOrder{
		ID: uuid.New(), TenantID: tid, Code: "WO-D-001", ItemID: item.ID,
		Qty: 1, Status: domain.WOStatusPlanned, Priority: domain.WOPriorityLow, Version: 1,
	}
	if err := wos.Create(context.Background(), wo); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := wos.SoftDelete(context.Background(), tid, wo.ID, 1); err != nil {
		t.Fatalf("delete: %v", err)
	}
	_, err := wos.GetByID(context.Background(), tid, wo.ID)
	if err != domain.ErrNotFound {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}
