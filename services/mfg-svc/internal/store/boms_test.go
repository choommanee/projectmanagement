package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
	"github.com/pmplatform/services/mfg-svc/internal/store"
)

func TestBOM_HeaderCreate(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	items := store.NewItems(p)
	boms := store.NewBOMs(p)
	u := seedUOM(t, items, tid)

	parent := &domain.Item{
		ID: uuid.New(), TenantID: tid, Code: "PARENT-001", Name: "Parent",
		Type: domain.ItemTypeAssembly, Status: domain.ItemStatusActive, UomID: u.ID, Attrs: map[string]any{}, Version: 1,
	}
	if err := items.Create(context.Background(), parent); err != nil {
		t.Fatalf("create item: %v", err)
	}

	h := &domain.BOMHeader{
		TenantID:  tid,
		ItemID:    parent.ID,
		IsDefault: true,
		Status:    domain.BOMStatusDraft,
	}
	if err := boms.CreateHeader(context.Background(), h); err != nil {
		t.Fatalf("create bom header: %v", err)
	}
	if h.ID == uuid.Nil {
		t.Error("expected non-nil bom header ID")
	}
	if h.Version != 1 {
		t.Errorf("version = %d, want 1", h.Version)
	}

	got, err := boms.GetHeaderByID(context.Background(), tid, h.ID)
	if err != nil {
		t.Fatalf("get bom header: %v", err)
	}
	if got.ItemID != parent.ID {
		t.Errorf("item_id mismatch")
	}
}

func TestBOM_AddLine(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	items := store.NewItems(p)
	boms := store.NewBOMs(p)
	u := seedUOM(t, items, tid)

	parent := &domain.Item{
		ID: uuid.New(), TenantID: tid, Code: "PARBL-001", Name: "Parent BL",
		Type: domain.ItemTypeAssembly, Status: domain.ItemStatusActive, UomID: u.ID, Attrs: map[string]any{}, Version: 1,
	}
	child := &domain.Item{
		ID: uuid.New(), TenantID: tid, Code: "CHILD-001", Name: "Child",
		Type: domain.ItemTypeComponent, Status: domain.ItemStatusActive, UomID: u.ID, Attrs: map[string]any{}, Version: 1,
	}
	for _, it := range []*domain.Item{parent, child} {
		if err := items.Create(context.Background(), it); err != nil {
			t.Fatalf("create item: %v", err)
		}
	}
	h := &domain.BOMHeader{TenantID: tid, ItemID: parent.ID, IsDefault: true, Status: domain.BOMStatusDraft}
	if err := boms.CreateHeader(context.Background(), h); err != nil {
		t.Fatalf("create bom header: %v", err)
	}
	l := &domain.BOMLine{
		TenantID:    tid,
		HeaderID:    h.ID,
		ChildItemID: child.ID,
		Qty:         3,
		UomID:       u.ID,
	}
	if err := boms.AddLine(context.Background(), l); err != nil {
		t.Fatalf("add line: %v", err)
	}
	lines, err := boms.ListByHeader(context.Background(), tid, h.ID)
	if err != nil {
		t.Fatalf("list lines: %v", err)
	}
	if len(lines) != 1 {
		t.Errorf("lines = %d, want 1", len(lines))
	}
	if lines[0].Qty != 3 {
		t.Errorf("qty = %v, want 3", lines[0].Qty)
	}
}

func TestBOM_ExplodeMultiLevel(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	items := store.NewItems(p)
	boms := store.NewBOMs(p)
	u := seedUOM(t, items, tid)

	// Build: FG → SUB (2x) → RAW (3x)
	fg := &domain.Item{ID: uuid.New(), TenantID: tid, Code: "FG-EXP", Name: "FG", Type: domain.ItemTypeAssembly, Status: domain.ItemStatusActive, UomID: u.ID, Attrs: map[string]any{}, Version: 1}
	sub := &domain.Item{ID: uuid.New(), TenantID: tid, Code: "SUB-EXP", Name: "SUB", Type: domain.ItemTypeAssembly, Status: domain.ItemStatusActive, UomID: u.ID, Attrs: map[string]any{}, Version: 1}
	raw := &domain.Item{ID: uuid.New(), TenantID: tid, Code: "RAW-EXP", Name: "RAW", Type: domain.ItemTypeRaw, Status: domain.ItemStatusActive, UomID: u.ID, Attrs: map[string]any{}, Version: 1}

	for _, it := range []*domain.Item{fg, sub, raw} {
		if err := items.Create(context.Background(), it); err != nil {
			t.Fatalf("create %s: %v", it.Code, err)
		}
	}

	// BOM for FG: 2x SUB
	hFG := &domain.BOMHeader{TenantID: tid, ItemID: fg.ID, IsDefault: true, Status: domain.BOMStatusDraft}
	if err := boms.CreateHeader(context.Background(), hFG); err != nil {
		t.Fatalf("create FG bom: %v", err)
	}
	if err := boms.AddLine(context.Background(), &domain.BOMLine{TenantID: tid, HeaderID: hFG.ID, ChildItemID: sub.ID, Qty: 2, UomID: u.ID}); err != nil {
		t.Fatalf("add FG line: %v", err)
	}
	if err := boms.MarkActive(context.Background(), tid, hFG.ID); err != nil {
		t.Fatalf("activate FG bom: %v", err)
	}

	// BOM for SUB: 3x RAW
	hSUB := &domain.BOMHeader{TenantID: tid, ItemID: sub.ID, IsDefault: true, Status: domain.BOMStatusDraft}
	if err := boms.CreateHeader(context.Background(), hSUB); err != nil {
		t.Fatalf("create SUB bom: %v", err)
	}
	if err := boms.AddLine(context.Background(), &domain.BOMLine{TenantID: tid, HeaderID: hSUB.ID, ChildItemID: raw.ID, Qty: 3, UomID: u.ID}); err != nil {
		t.Fatalf("add SUB line: %v", err)
	}
	if err := boms.MarkActive(context.Background(), tid, hSUB.ID); err != nil {
		t.Fatalf("activate SUB bom: %v", err)
	}

	// Explode FG qty=1: expect SUB(qty=2, lvl=1) and RAW(qty=6, lvl=2)
	rows, err := boms.ExplodeMultiLevel(context.Background(), tid, fg.ID, 1)
	if err != nil {
		t.Fatalf("explode: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("explode rows = %d, want 2", len(rows))
	}

	// Find RAW row and verify qty
	var rawQty float64
	for _, row := range rows {
		if row.ItemCode == "RAW-EXP" {
			rawQty = row.Qty
		}
	}
	if rawQty != 6 {
		t.Errorf("RAW qty = %v, want 6 (2 SUB * 3 RAW)", rawQty)
	}
}
