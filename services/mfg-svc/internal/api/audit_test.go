package api_test

import (
	"context"
	"testing"

	"github.com/pmplatform/libs/go/audit"

	"github.com/pmplatform/services/mfg-svc/internal/api"
	"github.com/pmplatform/services/mfg-svc/internal/service"
	"github.com/pmplatform/services/mfg-svc/internal/store"
)

// TestCreateWorkCenterEmitsAuditLog verifies that a successful write through
// the HTTP surface lands a row in the platform audit_log (real Postgres).
func TestCreateWorkCenterEmitsAuditLog(t *testing.T) {
	p := openTestPool(t)
	defer p.Close()
	tid := seedTestTenant(t, p)

	boms := store.NewBOMs(p)
	svc := service.New(
		store.NewItems(p), store.NewWorkCenters(p), boms, store.NewRoutings(p),
		store.NewWorkOrders(p, boms), store.NewMRP(p), store.NewGenealogy(p),
		store.NewInventory(p), store.NewSuppliers(p), store.NewPurchaseOrders(p),
		"http://localhost:19999", "http://localhost:19998",
	).WithAuditPublisher(audit.NewPgPublisher(p, "mfg-svc"))
	h := api.NewRouter(svc, nil)

	rr := doJSON(t, h, "POST", "/v1/work-centers",
		map[string]any{"code": "WC-AUD1", "name": "Audit Test WC"},
		map[string]string{"X-Tenant-Id": tid.String()})
	if rr.Code != 201 {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}

	var svcName, entityType string
	var entityID *string
	err := p.QueryRow(context.Background(),
		`SELECT service, entity_type, entity_id FROM audit_log
		 WHERE tenant_id = $1 AND action = 'mfg.work_center.create'
		 ORDER BY ts DESC LIMIT 1`, tid).Scan(&svcName, &entityType, &entityID)
	if err != nil {
		t.Fatalf("expected audit_log row for mfg.work_center.create: %v", err)
	}
	if svcName != "mfg-svc" || entityType != "work_center" || entityID == nil || *entityID == "" {
		t.Fatalf("unexpected audit row: service=%q entity_type=%q entity_id=%v", svcName, entityType, entityID)
	}
}
