package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
	"github.com/pmplatform/services/mfg-svc/internal/store"
)

func TestMRP_SaveAndList(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	items := store.NewItems(p)
	mrpStore := store.NewMRP(p)
	u := seedUOM(t, items, tid)

	item := &domain.Item{
		ID: uuid.New(), TenantID: tid, Code: "MRP-ITEM-01", Name: "MRP Item",
		Type: domain.ItemTypeFinished, Status: domain.ItemStatusActive, UomID: u.ID, Attrs: map[string]any{}, Version: 1,
	}
	if err := items.Create(context.Background(), item); err != nil {
		t.Fatalf("create item: %v", err)
	}

	run := &domain.MrpRun{
		TenantID: tid,
		Name:     "Test Run",
		Params:   map[string]any{"horizon": 30},
	}
	if err := mrpStore.CreateRun(context.Background(), run); err != nil {
		t.Fatalf("create run: %v", err)
	}
	if run.ID == uuid.Nil {
		t.Error("run ID should not be nil")
	}

	// Save demands
	demands := []*domain.MrpDemand{{
		TenantID:  tid,
		RunID:     run.ID,
		ItemID:    item.ID,
		Qty:       100,
		Source:    domain.MrpSourceWO,
		SourceRef: "WO-TEST-01",
	}}
	if err := mrpStore.SaveDemands(context.Background(), tid, demands); err != nil {
		t.Fatalf("save demands: %v", err)
	}

	// Save supplies
	supplies := []*domain.MrpSupply{{
		TenantID:  tid,
		RunID:     run.ID,
		ItemID:    item.ID,
		Qty:       20,
		Source:    domain.MrpSourceStock,
		SourceRef: "on-hand",
	}}
	if err := mrpStore.SaveSupplies(context.Background(), tid, supplies); err != nil {
		t.Fatalf("save supplies: %v", err)
	}

	// Save actions
	actions := []*domain.MrpAction{{
		TenantID:   tid,
		RunID:      run.ID,
		Action:     domain.MrpActionRelease,
		EntityType: "work_order",
		Message:    "Release 80 units",
	}}
	if err := mrpStore.SaveActions(context.Background(), tid, actions); err != nil {
		t.Fatalf("save actions: %v", err)
	}

	// List and verify
	gotDemands, err := mrpStore.ListDemands(context.Background(), tid, run.ID)
	if err != nil {
		t.Fatalf("list demands: %v", err)
	}
	if len(gotDemands) != 1 {
		t.Errorf("demands = %d, want 1", len(gotDemands))
	}
	if gotDemands[0].Qty != 100 {
		t.Errorf("demand qty = %v, want 100", gotDemands[0].Qty)
	}

	gotSupplies, err := mrpStore.ListSupplies(context.Background(), tid, run.ID)
	if err != nil {
		t.Fatalf("list supplies: %v", err)
	}
	if len(gotSupplies) != 1 {
		t.Errorf("supplies = %d, want 1", len(gotSupplies))
	}

	gotActions, err := mrpStore.ListActions(context.Background(), tid, run.ID)
	if err != nil {
		t.Fatalf("list actions: %v", err)
	}
	if len(gotActions) != 1 {
		t.Errorf("actions = %d, want 1", len(gotActions))
	}
	if gotActions[0].Action != domain.MrpActionRelease {
		t.Errorf("action = %v, want release", gotActions[0].Action)
	}
}

func TestMRP_RunSummary(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	items := store.NewItems(p)
	mrpStore := store.NewMRP(p)
	u := seedUOM(t, items, tid)

	item := &domain.Item{
		ID: uuid.New(), TenantID: tid, Code: "MRP-SUMM-01", Name: "Summary Item",
		Type: domain.ItemTypeComponent, Status: domain.ItemStatusActive, UomID: u.ID, Attrs: map[string]any{}, Version: 1,
	}
	if err := items.Create(context.Background(), item); err != nil {
		t.Fatalf("create item: %v", err)
	}

	run := &domain.MrpRun{TenantID: tid, Name: "Summary Run", Params: map[string]any{}}
	if err := mrpStore.CreateRun(context.Background(), run); err != nil {
		t.Fatalf("create run: %v", err)
	}

	_ = mrpStore.SaveActions(context.Background(), tid, []*domain.MrpAction{
		{TenantID: tid, RunID: run.ID, Action: domain.MrpActionNoop, EntityType: "mrp_run", Message: "nothing to do"},
	})

	summary, err := mrpStore.RunSummary(context.Background(), tid, run.ID)
	if err != nil {
		t.Fatalf("run summary: %v", err)
	}
	if summary.Actions != 1 {
		t.Errorf("actions = %d, want 1", summary.Actions)
	}
	if summary.Run.Name != "Summary Run" {
		t.Errorf("run name = %q", summary.Run.Name)
	}
}
