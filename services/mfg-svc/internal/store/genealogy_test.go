package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
	"github.com/pmplatform/services/mfg-svc/internal/store"
)

// createLotsForGenealogy seeds one UOM + one item, then creates N lots for that item.
func createLotsForGenealogy(t *testing.T, wos *store.WorkOrders, items *store.Items, tid uuid.UUID, lotNos ...string) []*domain.Lot {
	t.Helper()
	u := seedUOM(t, items, tid)
	it := &domain.Item{
		ID:       uuid.New(),
		TenantID: tid,
		Code:     "GITEM-" + uuid.New().String()[:6],
		Name:     "Genealogy Item",
		Type:     domain.ItemTypeFinished,
		Status:   domain.ItemStatusActive,
		UomID:    u.ID,
		Version:  1,
	}
	if err := items.Create(context.Background(), it); err != nil {
		t.Fatalf("create item: %v", err)
	}

	var lots []*domain.Lot
	for _, no := range lotNos {
		lot := &domain.Lot{
			TenantID:  tid,
			ItemID:    it.ID,
			LotNo:     no + "-" + uuid.New().String()[:4],
			QtyOnHand: 100,
			Status:    domain.LotStatusReleased,
		}
		if err := wos.CreateLot(context.Background(), lot); err != nil {
			t.Fatalf("create lot %s: %v", no, err)
		}
		lots = append(lots, lot)
	}
	return lots
}

func TestGenealogy_ForwardChainDepth2(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)

	items := store.NewItems(p)
	wos := store.NewWorkOrders(p, store.NewBOMs(p))
	gs := store.NewGenealogy(p)

	// Create L1 → L2 → L3 sharing one item
	lots := createLotsForGenealogy(t, wos, items, tid, "L-1", "L-2", "L-3")
	l1, l2, l3 := lots[0], lots[1], lots[2]

	if err := gs.AddGenealogy(context.Background(), tid, l1.ID, l2.ID, nil, nil); err != nil {
		t.Fatalf("add genealogy L1->L2: %v", err)
	}
	if err := gs.AddGenealogy(context.Background(), tid, l2.ID, l3.ID, nil, nil); err != nil {
		t.Fatalf("add genealogy L2->L3: %v", err)
	}

	nodes, err := gs.TraceForward(context.Background(), tid, l1.ID, 20)
	if err != nil {
		t.Fatalf("TraceForward: %v", err)
	}
	if len(nodes) < 2 {
		t.Fatalf("expected at least 2 forward nodes, got %d", len(nodes))
	}

	// Should include l2 at depth 1, l3 at depth 2
	depths := map[uuid.UUID]int{}
	for _, n := range nodes {
		depths[n.LotID] = n.Depth
	}
	if depths[l2.ID] != 1 {
		t.Errorf("L-2 depth = %d, want 1", depths[l2.ID])
	}
	if depths[l3.ID] != 2 {
		t.Errorf("L-3 depth = %d, want 2", depths[l3.ID])
	}
}

func TestGenealogy_BackwardChainDepth2(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)

	items := store.NewItems(p)
	wos := store.NewWorkOrders(p, store.NewBOMs(p))
	gs := store.NewGenealogy(p)

	// Create B1 → B2 → B3 sharing one item
	lots := createLotsForGenealogy(t, wos, items, tid, "B-1", "B-2", "B-3")
	b1, b2, b3 := lots[0], lots[1], lots[2]

	if err := gs.AddGenealogy(context.Background(), tid, b1.ID, b2.ID, nil, nil); err != nil {
		t.Fatalf("add genealogy B1->B2: %v", err)
	}
	if err := gs.AddGenealogy(context.Background(), tid, b2.ID, b3.ID, nil, nil); err != nil {
		t.Fatalf("add genealogy B2->B3: %v", err)
	}

	nodes, err := gs.TraceBackward(context.Background(), tid, b3.ID, 20)
	if err != nil {
		t.Fatalf("TraceBackward: %v", err)
	}
	if len(nodes) < 2 {
		t.Fatalf("expected at least 2 backward nodes, got %d", len(nodes))
	}

	// Should include b2 at depth 1, b1 at depth 2
	depths := map[uuid.UUID]int{}
	for _, n := range nodes {
		depths[n.LotID] = n.Depth
	}
	if depths[b2.ID] != 1 {
		t.Errorf("B-2 depth = %d, want 1", depths[b2.ID])
	}
	if depths[b1.ID] != 2 {
		t.Errorf("B-1 depth = %d, want 2", depths[b1.ID])
	}
}
