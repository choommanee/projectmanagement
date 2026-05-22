package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
	"github.com/pmplatform/services/mfg-svc/internal/service"
	"github.com/pmplatform/services/mfg-svc/internal/store"
)

var initURLParam = sync.OnceFunc(func() {
	libauth.URLParam = chi.URLParam
})

// NewRouter wires the mfg-svc HTTP surface.
//
// authz is the Cedar-backed authorizer used to gate write endpoints. When
// nil the RequireAction middleware becomes a no-op (libs/go/auth contract),
// which is how the legacy unit tests keep working without minting JWTs. The
// dedicated cedar_*_test.go cases pass a real *libpolicy.Adapter to exercise
// the allow/deny grid against the shared bundle.
//
// Per-instance ABAC scoping (Plan #6 Task 6 Step 3): every write route with
// an id in the path now uses RequireActionScoped against the matching
// Cedar entity (Item::{:id}, BOM::{:id}, BOMLine::{:id}, Routing::{:id},
// RoutingOp::{:id}, WorkCenter::{:id}, WorkOrder::{:id}, Lot::{:id}). The
// CedarLoader resolves each id to {tenant_id} from the matching table.
func NewRouter(svc *service.Service, authz libauth.Authorizer) http.Handler {
	return NewRouterWithLoader(svc, authz, nil)
}

// NewRouterWithLoader wires mfg-svc with an optional Cedar loader.
func NewRouterWithLoader(svc *service.Service, authz libauth.Authorizer, loader libauth.ResourceLoader) http.Handler {
	initURLParam()
	var loaderOpts []libauth.ScopedOption
	if loader != nil {
		loaderOpts = append(loaderOpts, libauth.WithLoader(loader))
	}

	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})

	r.Route("/v1", func(r chi.Router) {
		// UOMs
		r.Get("/uoms", listUOMs(svc))
		// no resource id at create time — ABAC for create gates by context.tenant_id only
		r.With(libauth.RequireAction(authz, "mfg.uom.create", "*")).Post("/uoms", createUOM(svc))
		r.Get("/uoms/{id}", getUOM(svc))

		// Items
		r.Get("/items", listItems(svc))
		// no resource id at create time — ABAC for create gates by context.tenant_id only
		r.With(libauth.RequireAction(authz, "mfg.item.create", "*")).Post("/items", createItem(svc))
		r.Get("/items/{id}", getItem(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.item.update", "Item::{:id}", loaderOpts...)).Patch("/items/{id}", updateItem(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.item.delete", "Item::{:id}", loaderOpts...)).Delete("/items/{id}", deleteItem(svc))

		// BOM nested under item — resource is the parent Item.
		r.Get("/items/{id}/boms", listBOMs(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.bom.create", "Item::{:id}", loaderOpts...)).Post("/items/{id}/boms", createBOM(svc))
		r.Get("/items/{id}/bom/explode", explodeBOM(svc))

		// Lots nested under item
		r.Get("/items/{id}/lots", listLots(svc))

		// Routings nested under item — resource is the parent Item.
		r.Get("/items/{id}/routings", listRoutings(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.routing.create", "Item::{:id}", loaderOpts...)).Post("/items/{id}/routings", createRouting(svc))

		// Work Centers
		r.Get("/work-centers", listWorkCenters(svc))
		// no resource id at create time — ABAC for create gates by context.tenant_id only
		r.With(libauth.RequireAction(authz, "mfg.work_center.create", "*")).Post("/work-centers", createWorkCenter(svc))
		r.Get("/work-centers/{id}", getWorkCenter(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.work_center.update", "WorkCenter::{:id}", loaderOpts...)).Patch("/work-centers/{id}", updateWorkCenter(svc))

		// BOM standalone
		r.Get("/boms/{id}", getBOM(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.bom.update", "BOM::{:id}", loaderOpts...)).Patch("/boms/{id}", updateBOM(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.bom.add_line", "BOM::{:id}", loaderOpts...)).Post("/boms/{id}/lines", addBOMLine(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.bom.activate", "BOM::{:id}", loaderOpts...)).Post("/boms/{id}/activate", activateBOM(svc))

		// BOM lines standalone
		r.With(libauth.RequireActionScoped(authz, "mfg.bom.update_line", "BOMLine::{:id}", loaderOpts...)).Patch("/bom-lines/{id}", updateBOMLine(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.bom.delete_line", "BOMLine::{:id}", loaderOpts...)).Delete("/bom-lines/{id}", deleteBOMLine(svc))

		// Routings standalone
		r.Get("/routings/{id}", getRouting(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.routing.update", "Routing::{:id}", loaderOpts...)).Patch("/routings/{id}", updateRouting(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.routing.add_operation", "Routing::{:id}", loaderOpts...)).Post("/routings/{id}/operations", addRoutingOp(svc))

		// Routing operations standalone
		r.With(libauth.RequireActionScoped(authz, "mfg.routing.update_operation", "RoutingOp::{:id}", loaderOpts...)).Patch("/routing-operations/{id}", updateRoutingOp(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.routing.delete_operation", "RoutingOp::{:id}", loaderOpts...)).Delete("/routing-operations/{id}", deleteRoutingOp(svc))

		// Work Orders
		r.Get("/work-orders", listWorkOrders(svc))
		// no resource id at create time — ABAC for create gates by context.tenant_id only
		r.With(libauth.RequireAction(authz, "mfg.work_order.create", "*")).Post("/work-orders", createWorkOrder(svc))
		r.Get("/work-orders/{id}", getWorkOrder(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.work_order.update", "WorkOrder::{:id}", loaderOpts...)).Patch("/work-orders/{id}", updateWorkOrder(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.work_order.delete", "WorkOrder::{:id}", loaderOpts...)).Delete("/work-orders/{id}", deleteWorkOrder(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.work_order.release", "WorkOrder::{:id}", loaderOpts...)).Post("/work-orders/{id}/release", releaseWorkOrder(svc))
		r.Get("/work-orders/{id}/operations", listWOOperations(svc))
		r.Get("/work-orders/{id}/materials", listWOMaterials(svc))

		// Lots standalone
		// no resource id at create time — ABAC for create gates by context.tenant_id only
		r.With(libauth.RequireAction(authz, "mfg.lot.create", "*")).Post("/lots", createLot(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.lot.update_status", "Lot::{:id}", loaderOpts...)).Patch("/lots/{id}/status", updateLotStatus(svc))
		r.With(libauth.RequireActionScoped(authz, "mfg.lot.add_genealogy", "Lot::{:id}", loaderOpts...)).Post("/lots/{id}/genealogy", addLotGenealogy(svc))
		r.Get("/lots/{id}/trace", traceLot(svc))

		// MRP
		// no resource id at create time — ABAC for create gates by context.tenant_id only
		r.With(libauth.RequireAction(authz, "mfg.mrp.run", "*")).Post("/mrp/runs", createMRPRun(svc))
		r.Get("/mrp/runs", listMRPRuns(svc))
		r.Get("/mrp/runs/{id}", getMRPRun(svc))
		r.Get("/mrp/runs/{id}/demands", listMRPDemands(svc))
		r.Get("/mrp/runs/{id}/supplies", listMRPSupplies(svc))
		r.Get("/mrp/runs/{id}/actions", listMRPActions(svc))
	})

	return r
}

// tenantOr400 parses X-Tenant-Id header.
func tenantOr400(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	raw := r.Header.Get("X-Tenant-Id")
	tid, err := uuid.Parse(raw)
	if err != nil {
		writeErr(w, 400, errors.New("X-Tenant-Id required"))
		return uuid.Nil, false
	}
	return tid, true
}

// --- UOM ---

type createUOMReq struct {
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	RatioToBase float64 `json:"ratio_to_base"`
}

func createUOM(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createUOMReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		u, err := svc.CreateUOM(r.Context(), service.CreateUOMInput{
			TenantID:    tid,
			Code:        req.Code,
			Name:        req.Name,
			RatioToBase: req.RatioToBase,
		})
		if err != nil {
			if errors.Is(err, domain.ErrInvalidInput) {
				writeErr(w, 400, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, u)
	}
}

func getUOM(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		u, err := svc.Items.GetUOMByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, u)
	}
}

func listUOMs(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		items, err := svc.Items.ListUOMs(r.Context(), tid)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
	}
}

// --- Items ---

type createItemReq struct {
	Code          string            `json:"code"`
	Name          string            `json:"name"`
	Description   string            `json:"description,omitempty"`
	Type          domain.ItemType   `json:"type,omitempty"`
	Status        domain.ItemStatus `json:"status,omitempty"`
	UomID         uuid.UUID         `json:"uom_id"`
	LotTracked    bool              `json:"lot_tracked,omitempty"`
	SerialTracked bool              `json:"serial_tracked,omitempty"`
	Attrs         map[string]any    `json:"attrs,omitempty"`
}

func createItem(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createItemReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		it, err := svc.CreateItem(r.Context(), service.CreateItemInput{
			TenantID:      tid,
			Code:          req.Code,
			Name:          req.Name,
			Description:   req.Description,
			Type:          req.Type,
			Status:        req.Status,
			UomID:         req.UomID,
			LotTracked:    req.LotTracked,
			SerialTracked: req.SerialTracked,
			Attrs:         req.Attrs,
		})
		if err != nil {
			if errors.Is(err, domain.ErrInvalidInput) {
				writeErr(w, 400, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, it)
	}
}

func getItem(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		it, err := svc.Items.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, it)
	}
}

func listItems(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		q := r.URL.Query().Get("q")
		typ := r.URL.Query().Get("type")
		status := r.URL.Query().Get("status")
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

		items, total, err := svc.Items.List(r.Context(), tid, store.ListItemsOpts{
			Q: q, Type: typ, Status: status, Limit: limit, Offset: offset,
		})
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateItemReq struct {
	Name          string            `json:"name,omitempty"`
	Description   string            `json:"description,omitempty"`
	Type          domain.ItemType   `json:"type,omitempty"`
	Status        domain.ItemStatus `json:"status,omitempty"`
	UomID         *uuid.UUID        `json:"uom_id,omitempty"`
	LotTracked    *bool             `json:"lot_tracked,omitempty"`
	SerialTracked *bool             `json:"serial_tracked,omitempty"`
	Attrs         map[string]any    `json:"attrs,omitempty"`
	Version       int               `json:"version"`
}

func updateItem(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req updateItemReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		it, err := svc.Items.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		if req.Name != "" {
			it.Name = req.Name
		}
		if req.Description != "" {
			it.Description = req.Description
		}
		if req.Type != "" {
			it.Type = req.Type
		}
		if req.Status != "" {
			it.Status = req.Status
		}
		if req.UomID != nil {
			it.UomID = *req.UomID
		}
		if req.LotTracked != nil {
			it.LotTracked = *req.LotTracked
		}
		if req.SerialTracked != nil {
			it.SerialTracked = *req.SerialTracked
		}
		if req.Attrs != nil {
			it.Attrs = req.Attrs
		}
		it.Version = req.Version
		if err := svc.Items.Update(r.Context(), it); err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, it)
	}
}

func deleteItem(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		version, _ := strconv.Atoi(r.URL.Query().Get("version"))
		if version <= 0 {
			writeErr(w, 400, errors.New("version query param required"))
			return
		}
		if err := svc.Items.SoftDelete(r.Context(), tid, id, version); err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		w.WriteHeader(204)
	}
}

// --- Work Centers ---

type createWCReq struct {
	Code              string         `json:"code"`
	Name              string         `json:"name"`
	Type              domain.WCType  `json:"type,omitempty"`
	CapacityPerDayHrs float64        `json:"capacity_per_day_hrs,omitempty"`
}

func createWorkCenter(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createWCReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		wc, err := svc.CreateWorkCenter(r.Context(), service.CreateWorkCenterInput{
			TenantID:          tid,
			Code:              req.Code,
			Name:              req.Name,
			Type:              req.Type,
			CapacityPerDayHrs: req.CapacityPerDayHrs,
		})
		if err != nil {
			if errors.Is(err, domain.ErrInvalidInput) {
				writeErr(w, 400, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, wc)
	}
}

func getWorkCenter(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		wc, err := svc.WorkCenters.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, wc)
	}
}

func listWorkCenters(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		items, err := svc.WorkCenters.List(r.Context(), tid)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
	}
}

type updateWCReq struct {
	Name              string            `json:"name,omitempty"`
	Type              domain.WCType     `json:"type,omitempty"`
	CapacityPerDayHrs *float64          `json:"capacity_per_day_hrs,omitempty"`
	Status            domain.ItemStatus `json:"status,omitempty"`
	Version           int               `json:"version"`
}

func updateWorkCenter(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req updateWCReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		wc, err := svc.WorkCenters.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		if req.Name != "" {
			wc.Name = req.Name
		}
		if req.Type != "" {
			wc.Type = req.Type
		}
		if req.CapacityPerDayHrs != nil {
			wc.CapacityPerDayHrs = *req.CapacityPerDayHrs
		}
		if req.Status != "" {
			wc.Status = req.Status
		}
		wc.Version = req.Version
		if err := svc.WorkCenters.Update(r.Context(), wc); err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, wc)
	}
}

// --- BOMs ---

type createBOMReq struct {
	Notes string `json:"notes,omitempty"`
}

func createBOM(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		itemID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req createBOMReq
		_ = json.NewDecoder(r.Body).Decode(&req)
		h := &domain.BOMHeader{
			TenantID:  tid,
			ItemID:    itemID,
			IsDefault: true,
			Status:    domain.BOMStatusDraft,
			Notes:     req.Notes,
		}
		if err := svc.BOMs.CreateHeader(r.Context(), h); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, h)
	}
}

func getBOM(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		h, err := svc.BOMs.GetHeaderByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, h)
	}
}

func listBOMs(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		itemID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		headers, err := svc.BOMs.ListByItem(r.Context(), tid, itemID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": headers, "total": len(headers)})
	}
}

type updateBOMReq struct {
	IsDefault bool              `json:"is_default,omitempty"`
	Status    domain.BOMStatus  `json:"status,omitempty"`
	Notes     string            `json:"notes,omitempty"`
}

func updateBOM(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req updateBOMReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		h, err := svc.BOMs.GetHeaderByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		if req.Notes != "" {
			h.Notes = req.Notes
		}
		if req.Status != "" {
			h.Status = req.Status
		}
		if err := svc.BOMs.UpdateHeader(r.Context(), h); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, h)
	}
}

func activateBOM(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		if err := svc.BOMs.MarkActive(r.Context(), tid, id); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		w.WriteHeader(204)
	}
}

type addBOMLineReq struct {
	ChildItemID   uuid.UUID  `json:"child_item_id"`
	Qty           float64    `json:"qty"`
	UomID         uuid.UUID  `json:"uom_id"`
	AlternateOfID *uuid.UUID `json:"alternate_of_id,omitempty"`
	IsPhantom     bool       `json:"is_phantom,omitempty"`
	ScrapPct      float64    `json:"scrap_pct,omitempty"`
	SortOrder     int        `json:"sort_order,omitempty"`
	Notes         string     `json:"notes,omitempty"`
}

func addBOMLine(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		headerID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req addBOMLineReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		l := &domain.BOMLine{
			TenantID:      tid,
			HeaderID:      headerID,
			ChildItemID:   req.ChildItemID,
			Qty:           req.Qty,
			UomID:         req.UomID,
			AlternateOfID: req.AlternateOfID,
			IsPhantom:     req.IsPhantom,
			ScrapPct:      req.ScrapPct,
			SortOrder:     req.SortOrder,
			Notes:         req.Notes,
		}
		if err := svc.BOMs.AddLine(r.Context(), l); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, l)
	}
}

func updateBOMLine(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req addBOMLineReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		l := &domain.BOMLine{
			ID:            id,
			TenantID:      tid,
			ChildItemID:   req.ChildItemID,
			Qty:           req.Qty,
			UomID:         req.UomID,
			IsPhantom:     req.IsPhantom,
			ScrapPct:      req.ScrapPct,
			SortOrder:     req.SortOrder,
			Notes:         req.Notes,
		}
		if err := svc.BOMs.UpdateLine(r.Context(), l); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, l)
	}
}

func deleteBOMLine(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		if err := svc.BOMs.DeleteLine(r.Context(), tid, id); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		w.WriteHeader(204)
	}
}

func explodeBOM(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		itemID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		qty := 1.0
		if qStr := r.URL.Query().Get("qty"); qStr != "" {
			if q, err := strconv.ParseFloat(qStr, 64); err == nil && q > 0 {
				qty = q
			}
		}
		rows, err := svc.BOMs.ExplodeMultiLevel(r.Context(), tid, itemID, qty)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": rows, "total": len(rows)})
	}
}

// --- Routings ---

type createRoutingReq struct {
	Notes string `json:"notes,omitempty"`
}

func createRouting(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		itemID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req createRoutingReq
		_ = json.NewDecoder(r.Body).Decode(&req)
		h := &domain.RoutingHeader{
			TenantID:  tid,
			ItemID:    itemID,
			IsDefault: true,
			Status:    domain.BOMStatusDraft,
			Notes:     req.Notes,
		}
		if err := svc.Routings.CreateHeader(r.Context(), h); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, h)
	}
}

func getRouting(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		h, err := svc.Routings.GetHeaderByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, h)
	}
}

func listRoutings(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		itemID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		headers, err := svc.Routings.ListByItem(r.Context(), tid, itemID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": headers, "total": len(headers)})
	}
}

type updateRoutingReq struct {
	Status domain.BOMStatus `json:"status,omitempty"`
	Notes  string           `json:"notes,omitempty"`
}

func updateRouting(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req updateRoutingReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		h, err := svc.Routings.GetHeaderByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		if req.Status != "" {
			h.Status = req.Status
		}
		if req.Notes != "" {
			h.Notes = req.Notes
		}
		if err := svc.Routings.UpdateHeader(r.Context(), h); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, h)
	}
}

type addRoutingOpReq struct {
	OpNo          int       `json:"op_no"`
	WorkCenterID  uuid.UUID `json:"work_center_id"`
	SetupMin      float64   `json:"setup_min,omitempty"`
	RunPerUnitMin float64   `json:"run_per_unit_min,omitempty"`
	Description   string    `json:"description,omitempty"`
}

func addRoutingOp(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		routingID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req addRoutingOpReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		op := &domain.RoutingOperation{
			TenantID:      tid,
			RoutingID:     routingID,
			OpNo:          req.OpNo,
			WorkCenterID:  req.WorkCenterID,
			SetupMin:      req.SetupMin,
			RunPerUnitMin: req.RunPerUnitMin,
			Description:   req.Description,
		}
		if err := svc.Routings.AddOperation(r.Context(), op); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, op)
	}
}

func updateRoutingOp(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req addRoutingOpReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		op := &domain.RoutingOperation{
			ID:            id,
			TenantID:      tid,
			OpNo:          req.OpNo,
			WorkCenterID:  req.WorkCenterID,
			SetupMin:      req.SetupMin,
			RunPerUnitMin: req.RunPerUnitMin,
			Description:   req.Description,
		}
		if err := svc.Routings.UpdateOperation(r.Context(), op); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, op)
	}
}

func deleteRoutingOp(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		if err := svc.Routings.DeleteOperation(r.Context(), tid, id); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		w.WriteHeader(204)
	}
}

// --- Work Orders ---

type createWOReq struct {
	Code          string            `json:"code"`
	ItemID        uuid.UUID         `json:"item_id"`
	Qty           float64           `json:"qty"`
	Status        domain.WOStatus   `json:"status,omitempty"`
	Priority      domain.WOPriority `json:"priority,omitempty"`
	DueDate       *string           `json:"due_date,omitempty"` // "YYYY-MM-DD"
	WorkCenterID  *uuid.UUID        `json:"work_center_id,omitempty"`
	Notes         string            `json:"notes,omitempty"`
}

func createWorkOrder(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createWOReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Code == "" || req.Qty <= 0 {
			writeErr(w, 400, errors.New("code and qty>0 required"))
			return
		}
		if req.Status == "" {
			req.Status = domain.WOStatusPlanned
		}
		if req.Priority == "" {
			req.Priority = domain.WOPriorityMed
		}
		wo := &domain.WorkOrder{
			ID:           uuid.New(),
			TenantID:     tid,
			Code:         req.Code,
			ItemID:       req.ItemID,
			Qty:          req.Qty,
			Status:       req.Status,
			Priority:     req.Priority,
			WorkCenterID: req.WorkCenterID,
			Notes:        req.Notes,
			Version:      1,
		}
		if req.DueDate != nil {
			t, err := parseDate(*req.DueDate)
			if err == nil {
				wo.DueDate = &t
			}
		}
		if err := svc.WorkOrders.Create(r.Context(), wo); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, wo)
	}
}

func getWorkOrder(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		wo, err := svc.WorkOrders.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, wo)
	}
}

func listWorkOrders(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		status := r.URL.Query().Get("status")
		q := r.URL.Query().Get("q")
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		var itemID *uuid.UUID
		if iStr := r.URL.Query().Get("item_id"); iStr != "" {
			if id, err := uuid.Parse(iStr); err == nil {
				itemID = &id
			}
		}
		items, total, err := svc.WorkOrders.List(r.Context(), tid, store.ListWOOpts{
			Status: status, Q: q, ItemID: itemID, Limit: limit, Offset: offset,
		})
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateWOReq struct {
	Status   domain.WOStatus   `json:"status,omitempty"`
	Priority domain.WOPriority `json:"priority,omitempty"`
	DueDate  *string           `json:"due_date,omitempty"`
	Notes    string            `json:"notes,omitempty"`
	Version  int               `json:"version"`
}

func updateWorkOrder(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req updateWOReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		wo, err := svc.WorkOrders.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		if req.Status != "" {
			wo.Status = req.Status
		}
		if req.Priority != "" {
			wo.Priority = req.Priority
		}
		if req.Notes != "" {
			wo.Notes = req.Notes
		}
		if req.DueDate != nil {
			t, err := parseDate(*req.DueDate)
			if err == nil {
				wo.DueDate = &t
			}
		}
		wo.Version = req.Version
		if err := svc.WorkOrders.Update(r.Context(), wo); err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, wo)
	}
}

func deleteWorkOrder(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		version, _ := strconv.Atoi(r.URL.Query().Get("version"))
		if version <= 0 {
			writeErr(w, 400, errors.New("version query param required"))
			return
		}
		if err := svc.WorkOrders.SoftDelete(r.Context(), tid, id, version); err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		w.WriteHeader(204)
	}
}

type releaseWOReq struct {
	Version int `json:"version"`
}

func releaseWorkOrder(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req releaseWOReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		wo, err := svc.WorkOrders.ReleaseWorkOrder(r.Context(), tid, id, req.Version)
		if err != nil {
			switch {
			case errors.Is(err, domain.ErrNotFound):
				writeErr(w, 404, err)
			case errors.Is(err, domain.ErrConflict):
				writeErr(w, 409, err)
			case errors.Is(err, domain.ErrInvalidInput):
				writeErr(w, 400, err)
			default:
				writeErr(w, 500, err)
			}
			return
		}
		writeJSON(w, 200, wo)
	}
}

func listWOOperations(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		ops, err := svc.WorkOrders.ListOperations(r.Context(), tid, id)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": ops, "total": len(ops)})
	}
}

func listWOMaterials(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		mats, err := svc.WorkOrders.ListMaterials(r.Context(), tid, id)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": mats, "total": len(mats)})
	}
}

// --- Lots ---

type createLotReq struct {
	ItemID      uuid.UUID        `json:"item_id"`
	LotNo       string           `json:"lot_no"`
	QtyOnHand   float64          `json:"qty_on_hand"`
	Status      domain.LotStatus `json:"status,omitempty"`
	SourceWOID  *uuid.UUID       `json:"source_wo_id,omitempty"`
}

func createLot(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createLotReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Status == "" {
			req.Status = domain.LotStatusReleased
		}
		lot := &domain.Lot{
			TenantID:   tid,
			ItemID:     req.ItemID,
			LotNo:      req.LotNo,
			QtyOnHand:  req.QtyOnHand,
			Status:     req.Status,
			SourceWOID: req.SourceWOID,
		}
		if err := svc.WorkOrders.CreateLot(r.Context(), lot); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, lot)
	}
}

func listLots(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		itemID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		lots, err := svc.WorkOrders.ListLotsByItem(r.Context(), tid, itemID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": lots, "total": len(lots)})
	}
}

type updateLotStatusReq struct {
	Status domain.LotStatus `json:"status"`
}

func updateLotStatus(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req updateLotStatusReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if err := svc.WorkOrders.UpdateLotStatus(r.Context(), tid, id, req.Status); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		w.WriteHeader(204)
	}
}

// --- MRP ---

type createMRPRunReq struct {
	Name string `json:"name"`
}

func createMRPRun(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createMRPRunReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Name == "" {
			req.Name = "MRP Run"
		}
		run, err := svc.RunMRP(r.Context(), tid, req.Name)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, run)
	}
}

func listMRPRuns(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		runs, err := svc.MRP.ListRuns(r.Context(), tid, limit)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		// Enrich with summary counts
		type runWithSummary struct {
			*domain.MrpRun
			DemandCount  int `json:"demand_count"`
			SupplyCount  int `json:"supply_count"`
			ActionCount  int `json:"action_count"`
		}
		var result []runWithSummary
		for _, run := range runs {
			s, err := svc.MRP.RunSummary(r.Context(), tid, run.ID)
			if err != nil {
				result = append(result, runWithSummary{MrpRun: run})
				continue
			}
			result = append(result, runWithSummary{
				MrpRun:      run,
				DemandCount: s.Demands,
				SupplyCount: s.Supplies,
				ActionCount: s.Actions,
			})
		}
		writeJSON(w, 200, map[string]any{"items": result, "total": len(result)})
	}
}

func getMRPRun(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		s, err := svc.MRP.RunSummary(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, s)
	}
}

func listMRPDemands(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		items, err := svc.MRP.ListDemands(r.Context(), tid, id)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
	}
}

func listMRPSupplies(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		items, err := svc.MRP.ListSupplies(r.Context(), tid, id)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
	}
}

func listMRPActions(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		items, err := svc.MRP.ListActions(r.Context(), tid, id)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
	}
}

// --- Lot Genealogy ---

type addGenealogyReq struct {
	ParentLotID uuid.UUID  `json:"parent_lot_id"`
	WorkOrderID *uuid.UUID `json:"work_order_id,omitempty"`
	Qty         *float64   `json:"qty,omitempty"`
}

func addLotGenealogy(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		childID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req addGenealogyReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.ParentLotID == uuid.Nil {
			writeErr(w, 400, errors.New("parent_lot_id required"))
			return
		}
		if err := svc.Genealogy.AddGenealogy(r.Context(), tid, req.ParentLotID, childID, req.WorkOrderID, req.Qty); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, map[string]string{"status": "ok"})
	}
}

func traceLot(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		lotID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		direction := r.URL.Query().Get("direction")
		if direction != "forward" && direction != "backward" {
			direction = "forward"
		}
		maxDepth, _ := strconv.Atoi(r.URL.Query().Get("max_depth"))
		if maxDepth <= 0 {
			maxDepth = 20
		}
		result, err := svc.Genealogy.TraceViaEngine(r.Context(), tid, lotID, direction, maxDepth, svc.TraceEngineURL)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, result)
	}
}

// --- Helpers ---

func parseDate(s string) (time.Time, error) {
	return time.Parse("2006-01-02", s)
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}
