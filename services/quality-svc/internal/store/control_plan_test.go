package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/quality-svc/internal/domain"
	"github.com/pmplatform/services/quality-svc/internal/store"
)

func TestControlPlan_Create(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	uomID := seedUOM(t, p, tid)
	itemID := seedItem(t, p, tid, uomID)

	s := store.NewControlPlan(p)
	c := &domain.ControlPlan{
		TenantID: tid,
		ItemID:   itemID,
		Name:     "Test Control Plan",
	}
	if err := s.Create(context.Background(), c); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if c.ID == uuid.Nil {
		t.Fatal("ID not set")
	}
	if c.Version != 1 {
		t.Errorf("version: %d", c.Version)
	}
}

func TestControlPlan_AddCharacteristic(t *testing.T) {
	p := testPool(t)
	tid := seedTenant(t, p)
	uomID := seedUOM(t, p, tid)
	itemID := seedItem(t, p, tid, uomID)

	s := store.NewControlPlan(p)
	c := &domain.ControlPlan{TenantID: tid, ItemID: itemID, Name: "CP-1"}
	if err := s.Create(context.Background(), c); err != nil {
		t.Fatalf("Create: %v", err)
	}

	ch := &domain.ControlPlanCharacteristic{
		TenantID:          tid,
		ControlPlanID:     c.ID,
		No:                1,
		Characteristic:    "Diameter",
		Spec:              "25.00 ± 0.05 mm",
		SampleSize:        "5",
		SampleFreq:        "Every shift",
		MeasurementMethod: "Caliper",
		ReactionPlan:      "Stop and notify QE",
	}
	if err := s.AddCharacteristic(context.Background(), ch); err != nil {
		t.Fatalf("AddCharacteristic: %v", err)
	}
	if ch.ID == uuid.Nil {
		t.Fatal("characteristic ID not set")
	}

	chars, err := s.ListCharacteristics(context.Background(), tid, c.ID)
	if err != nil {
		t.Fatalf("ListCharacteristics: %v", err)
	}
	if len(chars) != 1 {
		t.Fatalf("expected 1 char, got %d", len(chars))
	}
	if chars[0].Spec != "25.00 ± 0.05 mm" {
		t.Errorf("spec: %s", chars[0].Spec)
	}
}
