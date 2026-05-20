package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/quality-svc/internal/domain"
	"github.com/pmplatform/services/quality-svc/internal/store"
)

func TestPPAP_CreateAutoSeeds18Elements(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	uomID := seedUOM(t, p, tid)
	itemID := seedItem(t, p, tid, uomID)

	s := store.NewPPAP(p)
	sub := &domain.PPAPSubmission{
		TenantID: tid,
		ItemID:   itemID,
		PartNo:   "PN-001",
		Customer: "Acme",
		Level:    3,
	}
	if err := s.Create(context.Background(), sub); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if sub.ID == uuid.Nil {
		t.Fatal("ID not set")
	}

	elems, err := s.ListElements(context.Background(), tid, sub.ID)
	if err != nil {
		t.Fatalf("ListElements: %v", err)
	}
	if len(elems) != 18 {
		t.Fatalf("expected 18 elements, got %d", len(elems))
	}
	// Verify first and last element names
	if elems[0].Name != "Design Records" {
		t.Errorf("elem 1 name: %s", elems[0].Name)
	}
	if elems[17].Name != "Part Submission Warrant (PSW)" {
		t.Errorf("elem 18 name: %s", elems[17].Name)
	}
}

func TestPPAP_ListElements(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	uomID := seedUOM(t, p, tid)
	itemID := seedItem(t, p, tid, uomID)

	s := store.NewPPAP(p)
	sub := &domain.PPAPSubmission{TenantID: tid, ItemID: itemID, PartNo: "PN-002", Level: 1}
	if err := s.Create(context.Background(), sub); err != nil {
		t.Fatalf("Create: %v", err)
	}

	elems, err := s.ListElements(context.Background(), tid, sub.ID)
	if err != nil {
		t.Fatalf("ListElements: %v", err)
	}
	// All should default to not_required
	for _, e := range elems {
		if e.Status != domain.PPAPElemNotRequired {
			t.Errorf("elem %d status: %s", e.ElementNo, e.Status)
		}
	}
}

func TestPPAP_UpdateElementStatus(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	uomID := seedUOM(t, p, tid)
	itemID := seedItem(t, p, tid, uomID)

	s := store.NewPPAP(p)
	sub := &domain.PPAPSubmission{TenantID: tid, ItemID: itemID, PartNo: "PN-003", Level: 2}
	if err := s.Create(context.Background(), sub); err != nil {
		t.Fatalf("Create: %v", err)
	}

	elems, err := s.ListElements(context.Background(), tid, sub.ID)
	if err != nil {
		t.Fatalf("ListElements: %v", err)
	}
	// Update first element to complete
	elem, err := s.UpdateElement(context.Background(), tid, elems[0].ID, store.UpdatePPAPElementInput{
		Status:      domain.PPAPElemComplete,
		EvidenceURL: "https://example.com/design-records.pdf",
		Notes:       "Approved",
	})
	if err != nil {
		t.Fatalf("UpdateElement: %v", err)
	}
	if elem.Status != domain.PPAPElemComplete {
		t.Errorf("status: %s", elem.Status)
	}
	if elem.EvidenceURL != "https://example.com/design-records.pdf" {
		t.Errorf("url: %s", elem.EvidenceURL)
	}
}
