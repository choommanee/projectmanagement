package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/quality-svc/internal/api"
	"github.com/pmplatform/services/quality-svc/internal/service"
	"github.com/pmplatform/services/quality-svc/internal/store"
)

func setupSvc(t *testing.T) (*service.Service, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(p.Close)
	svc := service.New(
		store.NewAPQP(p),
		store.NewPPAP(p),
		store.NewFMEA(p),
		store.NewControlPlan(p),
		store.NewInspection(p),
		store.NewNCR(p),
	)
	return svc, p
}

func seedTestTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, $2, $3)`,
		tid, "api-test-"+tid.String()[:8], "API Test")
	if err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tid)
	})
	return tid
}

func seedTestItem(t *testing.T, p *pgxpool.Pool, tid uuid.UUID) uuid.UUID {
	t.Helper()
	uomID := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO uom(id, tenant_id, code, name, ratio_to_base) VALUES ($1,$2,$3,$4,$5)`,
		uomID, tid, "EA"+uomID.String()[:4], "Each", 1.0)
	if err != nil {
		t.Fatalf("seed uom: %v", err)
	}
	itemID := uuid.New()
	_, err = p.Exec(context.Background(),
		`INSERT INTO item(id, tenant_id, code, name, type, status, uom_id) VALUES ($1,$2,$3,$4,'finished','active',$5)`,
		itemID, tid, "ITEM"+itemID.String()[:4], "Test Item", uomID)
	if err != nil {
		t.Fatalf("seed item: %v", err)
	}
	return itemID
}

func TestHandler_Healthz(t *testing.T) {
	svc, _ := setupSvc(t)
	h := api.NewRouter(svc, nil)

	req := httptest.NewRequest("GET", "/healthz", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != 200 {
		t.Errorf("status: %d", w.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("status body: %v", body)
	}
}

func TestHandler_MissingTenant(t *testing.T) {
	svc, _ := setupSvc(t)
	h := api.NewRouter(svc, nil)

	req := httptest.NewRequest("GET", "/v1/apqp", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestHandler_PPAPCreateAndListElements(t *testing.T) {
	svc, p := setupSvc(t)
	h := api.NewRouter(svc, nil)
	tid := seedTestTenant(t, p)
	itemID := seedTestItem(t, p, tid)

	body := fmt.Sprintf(`{"item_id":%q,"part_no":"PN-API-001","customer":"Acme","level":3}`, itemID)
	req := httptest.NewRequest("POST", "/v1/ppap", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Tenant-Id", tid.String())
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)

	if w.Code != 201 {
		t.Fatalf("create PPAP status: %d, body: %s", w.Code, w.Body.String())
	}

	var sub map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &sub); err != nil {
		t.Fatalf("decode: %v", err)
	}
	subID, _ := sub["ID"].(string)
	if subID == "" {
		subID, _ = sub["id"].(string)
	}
	if subID == "" {
		t.Fatalf("no id in response: %v", sub)
	}

	req2 := httptest.NewRequest("GET", "/v1/ppap/"+subID+"/elements", nil)
	req2.Header.Set("X-Tenant-Id", tid.String())
	w2 := httptest.NewRecorder()
	h.ServeHTTP(w2, req2)

	if w2.Code != 200 {
		t.Fatalf("list elements status: %d", w2.Code)
	}
	var elems map[string]any
	if err := json.Unmarshal(w2.Body.Bytes(), &elems); err != nil {
		t.Fatalf("decode elems: %v", err)
	}
	items, _ := elems["items"].([]any)
	if len(items) != 18 {
		t.Errorf("expected 18 elements, got %d", len(items))
	}
}
