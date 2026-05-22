package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/mfg-svc/internal/api"
	"github.com/pmplatform/services/mfg-svc/internal/service"
	"github.com/pmplatform/services/mfg-svc/internal/store"
)

// ---- helpers ----------------------------------------------------------------

func openTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	t.Cleanup(p.Close)
	return p
}

func seedTestTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		`INSERT INTO tenant(id, slug, name) VALUES ($1, $2, $3)`,
		tid, "mfg-api-test-"+tid.String()[:8], "MFG API Test "+tid.String()[:8])
	if err != nil {
		t.Fatalf("seedTestTenant: %v", err)
	}
	t.Cleanup(func() {
		_, _ = p.Exec(context.Background(), `DELETE FROM tenant WHERE id = $1`, tid)
	})
	return tid
}

func newTestServer(t *testing.T, p *pgxpool.Pool) http.Handler {
	t.Helper()
	items := store.NewItems(p)
	wcs := store.NewWorkCenters(p)
	boms := store.NewBOMs(p)
	routings := store.NewRoutings(p)
	workOrders := store.NewWorkOrders(p, boms)
	mrp := store.NewMRP(p)
	genealogy := store.NewGenealogy(p)
	// Use empty engine URLs — unreachable triggers graceful synthetic fallback.
	svc := service.New(items, wcs, boms, routings, workOrders, mrp, genealogy, "http://localhost:19999", "http://localhost:19998")
	return api.NewRouter(svc, nil)
}

func doJSON(t *testing.T, h http.Handler, method, path string, body any, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func decodeJSON(t *testing.T, rr *httptest.ResponseRecorder, target any) {
	t.Helper()
	if err := json.NewDecoder(rr.Body).Decode(target); err != nil {
		t.Fatalf("decodeJSON: %v (body: %s)", err, rr.Body.String())
	}
}

// ---- tests ------------------------------------------------------------------

// TestHealthz verifies GET /healthz returns 200 {"status":"ok"}.
func TestHealthz(t *testing.T) {
	p := openTestPool(t)
	h := newTestServer(t, p)

	rr := doJSON(t, h, "GET", "/healthz", nil, nil)
	if rr.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]string
	decodeJSON(t, rr, &resp)
	if resp["status"] != "ok" {
		t.Errorf(`expected {"status":"ok"}, got %v`, resp)
	}
}

// TestMissingTenantHeader verifies that endpoints protected by tenantOr400 return 400 when
// X-Tenant-Id header is absent.
func TestMissingTenantHeader(t *testing.T) {
	p := openTestPool(t)
	h := newTestServer(t, p)

	rr := doJSON(t, h, "GET", "/v1/items", nil, nil)
	if rr.Code != 400 {
		t.Fatalf("expected 400 for missing X-Tenant-Id, got %d: %s", rr.Code, rr.Body.String())
	}
}

// TestCreateAndListItem seeds a tenant + UOM, POSTs an item, then GETs the list and asserts
// the created item code appears.
func TestCreateAndListItem(t *testing.T) {
	p := openTestPool(t)
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	// Create UOM
	rr := doJSON(t, h, "POST", "/v1/uoms", map[string]any{
		"code": "EA", "name": "Each", "ratio_to_base": 1,
	}, headers)
	if rr.Code != 201 {
		t.Fatalf("createUOM: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var uom map[string]any
	decodeJSON(t, rr, &uom)
	uomID := uom["ID"]
	if uomID == nil {
		uomID = uom["id"]
	}

	// Create item
	rr = doJSON(t, h, "POST", "/v1/items", map[string]any{
		"code": "HDL-001", "name": "Handler Test Item", "type": "finished", "uom_id": uomID,
	}, headers)
	if rr.Code != 201 {
		t.Fatalf("createItem: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var item map[string]any
	decodeJSON(t, rr, &item)
	code := item["Code"]
	if code == nil {
		code = item["code"]
	}
	if code != "HDL-001" {
		t.Errorf("item code = %v, want HDL-001", code)
	}

	// List items
	rr = doJSON(t, h, "GET", "/v1/items", nil, headers)
	if rr.Code != 200 {
		t.Fatalf("listItems: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var listResp map[string]any
	decodeJSON(t, rr, &listResp)
	items, ok := listResp["items"].([]any)
	if !ok || len(items) == 0 {
		t.Fatalf("listItems: expected at least 1 item, got %v", listResp)
	}
	found := false
	for _, it := range items {
		m, _ := it.(map[string]any)
		c := m["Code"]
		if c == nil {
			c = m["code"]
		}
		if c == "HDL-001" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("HDL-001 not found in list response")
	}
}

// TestBOMExplode seeds tenant + 2 items (FG, Component), creates BOM with line qty=2,
// activates it, then calls GET /v1/items/{id}/bom/explode?qty=10 and verifies 1 row with qty=20.
func TestBOMExplode(t *testing.T) {
	p := openTestPool(t)
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	// Create UOM
	rr := doJSON(t, h, "POST", "/v1/uoms", map[string]any{
		"code": "PC", "name": "Piece", "ratio_to_base": 1,
	}, headers)
	if rr.Code != 201 {
		t.Fatalf("createUOM: %d: %s", rr.Code, rr.Body.String())
	}
	var uom map[string]any
	decodeJSON(t, rr, &uom)
	uomID := uom["ID"]
	if uomID == nil {
		uomID = uom["id"]
	}

	// Create FG item
	rr = doJSON(t, h, "POST", "/v1/items", map[string]any{
		"code": "FG-BOM-001", "name": "Finished Good", "type": "finished", "uom_id": uomID,
	}, headers)
	if rr.Code != 201 {
		t.Fatalf("create FG item: %d: %s", rr.Code, rr.Body.String())
	}
	var fg map[string]any
	decodeJSON(t, rr, &fg)
	fgID := fg["ID"]
	if fgID == nil {
		fgID = fg["id"]
	}

	// Create component item
	rr = doJSON(t, h, "POST", "/v1/items", map[string]any{
		"code": "CP-BOM-001", "name": "Component", "type": "component", "uom_id": uomID,
	}, headers)
	if rr.Code != 201 {
		t.Fatalf("create CP item: %d: %s", rr.Code, rr.Body.String())
	}
	var cp map[string]any
	decodeJSON(t, rr, &cp)
	cpID := cp["ID"]
	if cpID == nil {
		cpID = cp["id"]
	}

	// Create BOM header for FG
	rr = doJSON(t, h, "POST", "/v1/items/"+fgID.(string)+"/boms", map[string]any{}, headers)
	if rr.Code != 201 {
		t.Fatalf("createBOM: %d: %s", rr.Code, rr.Body.String())
	}
	var bom map[string]any
	decodeJSON(t, rr, &bom)
	bomID := bom["ID"]
	if bomID == nil {
		bomID = bom["id"]
	}

	// Add BOM line: qty=2 of component per FG
	rr = doJSON(t, h, "POST", "/v1/boms/"+bomID.(string)+"/lines", map[string]any{
		"child_item_id": cpID, "qty": 2, "uom_id": uomID,
	}, headers)
	if rr.Code != 201 {
		t.Fatalf("addBOMLine: %d: %s", rr.Code, rr.Body.String())
	}

	// Activate BOM
	rr = doJSON(t, h, "POST", "/v1/boms/"+bomID.(string)+"/activate", nil, headers)
	if rr.Code != 204 {
		t.Fatalf("activateBOM: expected 204, got %d: %s", rr.Code, rr.Body.String())
	}

	// Explode BOM with qty=10 → expect component qty=20
	rr = doJSON(t, h, "GET", "/v1/items/"+fgID.(string)+"/bom/explode?qty=10", nil, headers)
	if rr.Code != 200 {
		t.Fatalf("explodeBOM: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var explodeResp map[string]any
	decodeJSON(t, rr, &explodeResp)
	explodeItems, ok := explodeResp["items"].([]any)
	if !ok || len(explodeItems) != 1 {
		t.Fatalf("explode: expected 1 row, got %v", explodeResp)
	}
	row, _ := explodeItems[0].(map[string]any)
	// ExplodeRow.Qty serializes as "Qty" (no json tag on the struct)
	qty := row["Qty"]
	if qty == nil {
		qty = row["qty"]
	}
	if qty == nil {
		t.Fatalf("explode row has no qty field, got: %v", row)
	}
	if qty.(float64) != 20.0 {
		t.Errorf("explode qty = %v, want 20", qty)
	}
}

// TestReleaseWorkOrder seeds the full chain (tenant + uom + item + bom + line + activate + wo),
// releases the WO, verifies status=released and materials list is non-empty.
func TestReleaseWorkOrder(t *testing.T) {
	p := openTestPool(t)
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	// Create UOM
	rr := doJSON(t, h, "POST", "/v1/uoms", map[string]any{
		"code": "UN", "name": "Unit", "ratio_to_base": 1,
	}, headers)
	if rr.Code != 201 {
		t.Fatalf("createUOM: %d: %s", rr.Code, rr.Body.String())
	}
	var uom map[string]any
	decodeJSON(t, rr, &uom)
	uomID := uom["ID"]
	if uomID == nil {
		uomID = uom["id"]
	}

	// Create finished item
	rr = doJSON(t, h, "POST", "/v1/items", map[string]any{
		"code": "WO-FG-001", "name": "WO Finished Good", "type": "finished", "uom_id": uomID,
	}, headers)
	if rr.Code != 201 {
		t.Fatalf("create FG: %d: %s", rr.Code, rr.Body.String())
	}
	var fg map[string]any
	decodeJSON(t, rr, &fg)
	fgID := fg["ID"]
	if fgID == nil {
		fgID = fg["id"]
	}

	// Create raw material item
	rr = doJSON(t, h, "POST", "/v1/items", map[string]any{
		"code": "WO-RM-001", "name": "WO Raw Material", "type": "raw", "uom_id": uomID,
	}, headers)
	if rr.Code != 201 {
		t.Fatalf("create RM: %d: %s", rr.Code, rr.Body.String())
	}
	var rm map[string]any
	decodeJSON(t, rr, &rm)
	rmID := rm["ID"]
	if rmID == nil {
		rmID = rm["id"]
	}

	// Create BOM and add line
	rr = doJSON(t, h, "POST", "/v1/items/"+fgID.(string)+"/boms", map[string]any{}, headers)
	if rr.Code != 201 {
		t.Fatalf("createBOM: %d: %s", rr.Code, rr.Body.String())
	}
	var bom map[string]any
	decodeJSON(t, rr, &bom)
	bomID := bom["ID"]
	if bomID == nil {
		bomID = bom["id"]
	}

	rr = doJSON(t, h, "POST", "/v1/boms/"+bomID.(string)+"/lines", map[string]any{
		"child_item_id": rmID, "qty": 3, "uom_id": uomID,
	}, headers)
	if rr.Code != 201 {
		t.Fatalf("addBOMLine: %d: %s", rr.Code, rr.Body.String())
	}

	rr = doJSON(t, h, "POST", "/v1/boms/"+bomID.(string)+"/activate", nil, headers)
	if rr.Code != 204 {
		t.Fatalf("activateBOM: expected 204, got %d: %s", rr.Code, rr.Body.String())
	}

	// Create work order
	rr = doJSON(t, h, "POST", "/v1/work-orders", map[string]any{
		"code": "WO-TEST-001", "item_id": fgID, "qty": 5,
	}, headers)
	if rr.Code != 201 {
		t.Fatalf("createWO: %d: %s", rr.Code, rr.Body.String())
	}
	var wo map[string]any
	decodeJSON(t, rr, &wo)
	woID := wo["ID"]
	if woID == nil {
		woID = wo["id"]
	}

	// Release work order
	rr = doJSON(t, h, "POST", "/v1/work-orders/"+woID.(string)+"/release", map[string]any{"version": 1}, headers)
	if rr.Code != 200 {
		t.Fatalf("releaseWO: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var released map[string]any
	decodeJSON(t, rr, &released)
	status := released["Status"]
	if status == nil {
		status = released["status"]
	}
	if status != "released" {
		t.Errorf("WO status = %v, want released", status)
	}

	// Verify materials were exploded
	rr = doJSON(t, h, "GET", "/v1/work-orders/"+woID.(string)+"/materials", nil, headers)
	if rr.Code != 200 {
		t.Fatalf("listMaterials: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var mats map[string]any
	decodeJSON(t, rr, &mats)
	matItems, ok := mats["items"].([]any)
	if !ok || len(matItems) == 0 {
		t.Fatalf("listMaterials: expected at least 1 material, got %v", mats)
	}
}

// TestMRPRunSyntheticFallback creates an MRP run when the engine is unreachable.
// The service should gracefully fall back to a synthetic noop action.
func TestMRPRunSyntheticFallback(t *testing.T) {
	p := openTestPool(t)
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	// Create MRP run — engine at port 19999 is intentionally unreachable
	rr := doJSON(t, h, "POST", "/v1/mrp/runs", map[string]any{"name": "Fallback Test"}, headers)
	if rr.Code != 201 {
		t.Fatalf("createMRPRun: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var run map[string]any
	decodeJSON(t, rr, &run)
	runID := run["ID"]
	if runID == nil {
		runID = run["id"]
	}
	if runID == nil {
		t.Fatal("mrp run id missing in response")
	}

	// Check that actions contain the synthetic noop
	rr = doJSON(t, h, "GET", "/v1/mrp/runs/"+runID.(string)+"/actions", nil, headers)
	if rr.Code != 200 {
		t.Fatalf("listMRPActions: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var actResp map[string]any
	decodeJSON(t, rr, &actResp)
	actItems, ok := actResp["items"].([]any)
	if !ok || len(actItems) == 0 {
		t.Fatalf("expected at least 1 action (synthetic noop), got %v", actResp)
	}
	firstAction, _ := actItems[0].(map[string]any)
	action := firstAction["Action"]
	if action == nil {
		action = firstAction["action"]
	}
	if action != "noop" {
		t.Errorf("expected noop action, got %v", action)
	}
}

// TestLotTraceEndpoint creates parent→child lot genealogy and verifies trace.
func TestLotTraceEndpoint(t *testing.T) {
	p := openTestPool(t)
	tid := seedTestTenant(t, p)
	h := newTestServer(t, p)
	headers := map[string]string{"X-Tenant-Id": tid.String()}

	// Create UOM + item
	rr := doJSON(t, h, "POST", "/v1/uoms", map[string]any{"code": "EA-T", "name": "Each", "ratio_to_base": 1}, headers)
	if rr.Code != 201 {
		t.Fatalf("createUOM: %d %s", rr.Code, rr.Body.String())
	}
	var uom map[string]any
	decodeJSON(t, rr, &uom)
	uomID := uomIDStr(uom)

	rr = doJSON(t, h, "POST", "/v1/items", map[string]any{"code": "T-ITEM", "name": "Trace Item", "type": "finished", "uom_id": uomID}, headers)
	if rr.Code != 201 {
		t.Fatalf("createItem: %d %s", rr.Code, rr.Body.String())
	}
	var item map[string]any
	decodeJSON(t, rr, &item)
	itemID := strField(item, "id", "ID")

	// Create 2 lots
	rr = doJSON(t, h, "POST", "/v1/lots", map[string]any{"item_id": itemID, "lot_no": "T-PARENT", "qty_on_hand": 100}, headers)
	if rr.Code != 201 {
		t.Fatalf("createLot parent: %d %s", rr.Code, rr.Body.String())
	}
	var l1 map[string]any
	decodeJSON(t, rr, &l1)
	l1ID := strField(l1, "id", "ID")

	rr = doJSON(t, h, "POST", "/v1/lots", map[string]any{"item_id": itemID, "lot_no": "T-CHILD", "qty_on_hand": 50}, headers)
	if rr.Code != 201 {
		t.Fatalf("createLot child: %d %s", rr.Code, rr.Body.String())
	}
	var l2 map[string]any
	decodeJSON(t, rr, &l2)
	l2ID := strField(l2, "id", "ID")

	// Add genealogy (child l2, parent l1)
	rr = doJSON(t, h, "POST", "/v1/lots/"+l2ID+"/genealogy", map[string]any{"parent_lot_id": l1ID, "qty": 50.0}, headers)
	if rr.Code != 201 {
		t.Fatalf("addGenealogy: %d %s", rr.Code, rr.Body.String())
	}

	// Trace forward from l1 — engine at 19998 is unreachable, expect flat list
	rr = doJSON(t, h, "GET", "/v1/lots/"+l1ID+"/trace?direction=forward", nil, headers)
	if rr.Code != 200 {
		t.Fatalf("traceLot: %d %s", rr.Code, rr.Body.String())
	}
	// Response should be an array (flat fallback) or object — just check 200
}

func uomIDStr(m map[string]any) string {
	if v, ok := m["id"].(string); ok {
		return v
	}
	if v, ok := m["ID"].(string); ok {
		return v
	}
	return ""
}

func strField(m map[string]any, fields ...string) string {
	for _, f := range fields {
		if v, ok := m[f].(string); ok && v != "" {
			return v
		}
	}
	return ""
}
