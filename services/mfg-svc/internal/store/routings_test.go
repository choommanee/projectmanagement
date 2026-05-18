package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
	"github.com/pmplatform/services/mfg-svc/internal/store"
)

func TestRouting_Create(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	items := store.NewItems(p)
	routings := store.NewRoutings(p)
	wcs := store.NewWorkCenters(p)
	u := seedUOM(t, items, tid)

	item := &domain.Item{
		ID: uuid.New(), TenantID: tid, Code: "RIT-001", Name: "Routing Item",
		Type: domain.ItemTypeFinished, Status: domain.ItemStatusActive, UomID: u.ID, Attrs: map[string]any{}, Version: 1,
	}
	if err := items.Create(context.Background(), item); err != nil {
		t.Fatalf("create item: %v", err)
	}

	h := &domain.RoutingHeader{TenantID: tid, ItemID: item.ID, IsDefault: true, Status: domain.BOMStatusDraft}
	if err := routings.CreateHeader(context.Background(), h); err != nil {
		t.Fatalf("create routing: %v", err)
	}
	if h.ID == uuid.Nil {
		t.Error("routing ID should not be nil")
	}

	got, err := routings.GetHeaderByID(context.Background(), tid, h.ID)
	if err != nil {
		t.Fatalf("get routing: %v", err)
	}
	if got.ItemID != item.ID {
		t.Errorf("item_id mismatch")
	}

	// Add work center
	wc := &domain.WorkCenter{
		ID: uuid.New(), TenantID: tid, Code: "WC-R01", Name: "Assembly Line",
		Type: domain.WCTypeMachine, CapacityPerDayHrs: 8, Status: domain.ItemStatusActive, Version: 1,
	}
	if err := wcs.Create(context.Background(), wc); err != nil {
		t.Fatalf("create wc: %v", err)
	}

	op := &domain.RoutingOperation{
		TenantID: tid, RoutingID: h.ID, OpNo: 10,
		WorkCenterID: wc.ID, SetupMin: 5, RunPerUnitMin: 2, Description: "Assemble",
	}
	if err := routings.AddOperation(context.Background(), op); err != nil {
		t.Fatalf("add op: %v", err)
	}

	ops, err := routings.ListByRouting(context.Background(), tid, h.ID)
	if err != nil {
		t.Fatalf("list ops: %v", err)
	}
	if len(ops) != 1 {
		t.Errorf("ops = %d, want 1", len(ops))
	}
	if ops[0].OpNo != 10 {
		t.Errorf("op_no = %d, want 10", ops[0].OpNo)
	}
}

func TestRouting_AddOps(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	items := store.NewItems(p)
	routings := store.NewRoutings(p)
	wcs := store.NewWorkCenters(p)
	u := seedUOM(t, items, tid)

	item := &domain.Item{
		ID: uuid.New(), TenantID: tid, Code: "RIT-002", Name: "Multi-Op Item",
		Type: domain.ItemTypeFinished, Status: domain.ItemStatusActive, UomID: u.ID, Attrs: map[string]any{}, Version: 1,
	}
	if err := items.Create(context.Background(), item); err != nil {
		t.Fatalf("create item: %v", err)
	}
	h := &domain.RoutingHeader{TenantID: tid, ItemID: item.ID, IsDefault: true, Status: domain.BOMStatusDraft}
	if err := routings.CreateHeader(context.Background(), h); err != nil {
		t.Fatalf("create routing: %v", err)
	}

	wc := &domain.WorkCenter{
		ID: uuid.New(), TenantID: tid, Code: "WC-R02", Name: "CNC Machine",
		Type: domain.WCTypeMachine, CapacityPerDayHrs: 8, Status: domain.ItemStatusActive, Version: 1,
	}
	if err := wcs.Create(context.Background(), wc); err != nil {
		t.Fatalf("create wc: %v", err)
	}

	for _, opNo := range []int{10, 20, 30} {
		op := &domain.RoutingOperation{
			TenantID: tid, RoutingID: h.ID, OpNo: opNo,
			WorkCenterID: wc.ID, SetupMin: 5, RunPerUnitMin: float64(opNo) / 10,
		}
		if err := routings.AddOperation(context.Background(), op); err != nil {
			t.Fatalf("add op %d: %v", opNo, err)
		}
	}

	ops, err := routings.ListByRouting(context.Background(), tid, h.ID)
	if err != nil {
		t.Fatalf("list ops: %v", err)
	}
	if len(ops) != 3 {
		t.Errorf("ops = %d, want 3", len(ops))
	}
}
