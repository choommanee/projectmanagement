package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/quality-svc/internal/domain"
	"github.com/pmplatform/services/quality-svc/internal/store"
)

func TestFMEA_Create(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	uomID := seedUOM(t, p, tid)
	itemID := seedItem(t, p, tid, uomID)

	s := store.NewFMEA(p)
	f := &domain.FMEA{
		TenantID: tid,
		Type:     domain.FMEATypePFMEA,
		ItemID:   &itemID,
		Name:     "Test PFMEA",
		Team:     []string{"Alice", "Bob"},
	}
	if err := s.Create(context.Background(), f); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if f.ID == uuid.Nil {
		t.Fatal("ID not set")
	}

	got, err := s.GetByID(context.Background(), tid, f.ID)
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if got.Name != "Test PFMEA" {
		t.Errorf("name: %s", got.Name)
	}
	if len(got.Team) != 2 {
		t.Errorf("team len: %d", len(got.Team))
	}
}

func TestFMEA_AddFailureModeRPN(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	uomID := seedUOM(t, p, tid)
	itemID := seedItem(t, p, tid, uomID)

	s := store.NewFMEA(p)
	f := &domain.FMEA{TenantID: tid, Type: domain.FMEATypePFMEA, ItemID: &itemID, Name: "RPN Test"}
	if err := s.Create(context.Background(), f); err != nil {
		t.Fatalf("Create: %v", err)
	}

	m := &domain.FMEAFailureMode{
		TenantID:    tid,
		FMEAID:      f.ID,
		Function:    "Cut",
		FailureMode: "Out of tolerance",
		Effect:      "Reject",
		Severity:    7,
		Cause:       "Tool wear",
		Occurrence:  4,
		Detection:   3,
		Actions:     "Monitor tool wear",
	}
	if err := s.AddFailureMode(context.Background(), m); err != nil {
		t.Fatalf("AddFailureMode: %v", err)
	}
	// RPN = 7*4*3 = 84
	if m.RPN != 84 {
		t.Errorf("RPN = %d, want 84", m.RPN)
	}

	modes, err := s.ListFailureModes(context.Background(), tid, f.ID)
	if err != nil {
		t.Fatalf("ListFailureModes: %v", err)
	}
	if len(modes) != 1 {
		t.Fatalf("expected 1 mode, got %d", len(modes))
	}
	if modes[0].RPN != 84 {
		t.Errorf("stored RPN = %d", modes[0].RPN)
	}
}

func TestFMEA_UpdateMode(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	uomID := seedUOM(t, p, tid)
	itemID := seedItem(t, p, tid, uomID)

	s := store.NewFMEA(p)
	f := &domain.FMEA{TenantID: tid, Type: domain.FMEATypeDFMEA, ItemID: &itemID, Name: "DFMEA"}
	if err := s.Create(context.Background(), f); err != nil {
		t.Fatalf("Create: %v", err)
	}

	m := &domain.FMEAFailureMode{
		TenantID:    tid,
		FMEAID:      f.ID,
		Function:    "Seal",
		FailureMode: "Leak",
		Severity:    5,
		Occurrence:  3,
		Detection:   2,
	}
	if err := s.AddFailureMode(context.Background(), m); err != nil {
		t.Fatalf("AddFailureMode: %v", err)
	}

	updated, err := s.UpdateFailureMode(context.Background(), tid, m.ID, store.UpdateFMEAModeInput{
		Function:    "Seal",
		FailureMode: "Leak",
		Severity:    8,
		Occurrence:  3,
		Detection:   2,
		Actions:     "Redesign seal",
	})
	if err != nil {
		t.Fatalf("UpdateFailureMode: %v", err)
	}
	// RPN should be 8*3*2=48
	if updated.RPN != 48 {
		t.Errorf("updated RPN = %d, want 48", updated.RPN)
	}
}
