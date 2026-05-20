package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/quality-svc/internal/domain"
	"github.com/pmplatform/services/quality-svc/internal/store"
)

func TestNCR_Create(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	uomID := seedUOM(t, p, tid)
	itemID := seedItem(t, p, tid, uomID)

	s := store.NewNCR(p)
	n := &domain.Nonconformance{
		TenantID:    tid,
		ItemID:      itemID,
		Qty:         5,
		Severity:    3,
		Description: "Surface scratch",
	}
	if err := s.Create(context.Background(), n); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if n.ID == uuid.Nil {
		t.Fatal("ID not set")
	}
	if n.Status != domain.NCRStatusOpen {
		t.Errorf("status: %s", n.Status)
	}
}

func TestNCR_AttachCAPA(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	uomID := seedUOM(t, p, tid)
	itemID := seedItem(t, p, tid, uomID)

	s := store.NewNCR(p)
	n := &domain.Nonconformance{TenantID: tid, ItemID: itemID, Qty: 2, Severity: 2, Description: "Dimension out"}
	if err := s.Create(context.Background(), n); err != nil {
		t.Fatalf("Create NCR: %v", err)
	}

	c := &domain.CAPA{
		TenantID:         tid,
		NonconformanceID: n.ID,
		RootCause:        "Tool wear",
		Action:           "Replace tooling",
	}
	if err := s.CreateCAPA(context.Background(), c); err != nil {
		t.Fatalf("CreateCAPA: %v", err)
	}
	if c.ID == uuid.Nil {
		t.Fatal("CAPA ID not set")
	}

	capas, err := s.GetCAPA(context.Background(), tid, n.ID)
	if err != nil {
		t.Fatalf("GetCAPA: %v", err)
	}
	if len(capas) != 1 {
		t.Fatalf("expected 1 capa, got %d", len(capas))
	}
	if capas[0].RootCause != "Tool wear" {
		t.Errorf("root_cause: %s", capas[0].RootCause)
	}
}

func TestNCR_List(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	uomID := seedUOM(t, p, tid)
	itemID := seedItem(t, p, tid, uomID)

	s := store.NewNCR(p)
	for i := 0; i < 3; i++ {
		n := &domain.Nonconformance{TenantID: tid, ItemID: itemID, Qty: float64(i + 1), Severity: 1, Description: "Test NCR"}
		if err := s.Create(context.Background(), n); err != nil {
			t.Fatalf("Create: %v", err)
		}
	}

	items, total, err := s.List(context.Background(), tid, store.ListNCROpts{Status: "open"})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total < 3 {
		t.Errorf("expected at least 3, got %d", total)
	}
	for _, n := range items {
		if n.Status != domain.NCRStatusOpen {
			t.Errorf("unexpected status: %s", n.Status)
		}
	}
}
