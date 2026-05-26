package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
	"github.com/pmplatform/services/mfg-svc/internal/service"
	"github.com/pmplatform/services/mfg-svc/internal/store"
)

// --- Suppliers ---

type createSupplierReq struct {
	Code         string `json:"code"`
	Name         string `json:"name"`
	Contact      string `json:"contact,omitempty"`
	Email        string `json:"email,omitempty"`
	Phone        string `json:"phone,omitempty"`
	LeadTimeDays int    `json:"lead_time_days,omitempty"`
	Active       *bool  `json:"active,omitempty"`
}

func createSupplier(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createSupplierReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Code == "" || req.Name == "" {
			writeErr(w, 400, errors.New("code and name are required"))
			return
		}
		active := true
		if req.Active != nil {
			active = *req.Active
		}
		sup := &domain.Supplier{
			ID:           uuid.New(),
			TenantID:     tid,
			Code:         req.Code,
			Name:         req.Name,
			Contact:      req.Contact,
			Email:        req.Email,
			Phone:        req.Phone,
			LeadTimeDays: req.LeadTimeDays,
			Active:       active,
			Version:      1,
		}
		if err := svc.Suppliers.Create(r.Context(), sup); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, sup)
	}
}

func getSupplier(svc *service.Service) http.HandlerFunc {
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
		sup, err := svc.Suppliers.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, sup)
	}
}

func listSuppliers(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		q := r.URL.Query().Get("q")
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		var activeFilter *bool
		if aStr := r.URL.Query().Get("active"); aStr != "" {
			v := aStr == "true"
			activeFilter = &v
		}
		items, total, err := svc.Suppliers.List(r.Context(), tid, store.ListSuppliersOpts{
			Q: q, Active: activeFilter, Limit: limit, Offset: offset,
		})
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateSupplierReq struct {
	Name         string `json:"name,omitempty"`
	Contact      string `json:"contact,omitempty"`
	Email        string `json:"email,omitempty"`
	Phone        string `json:"phone,omitempty"`
	LeadTimeDays *int   `json:"lead_time_days,omitempty"`
	Active       *bool  `json:"active,omitempty"`
	Version      int    `json:"version"`
}

func updateSupplier(svc *service.Service) http.HandlerFunc {
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
		var req updateSupplierReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		sup, err := svc.Suppliers.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		if req.Name != "" {
			sup.Name = req.Name
		}
		if req.Contact != "" {
			sup.Contact = req.Contact
		}
		if req.Email != "" {
			sup.Email = req.Email
		}
		if req.Phone != "" {
			sup.Phone = req.Phone
		}
		if req.LeadTimeDays != nil {
			sup.LeadTimeDays = *req.LeadTimeDays
		}
		if req.Active != nil {
			sup.Active = *req.Active
		}
		sup.Version = req.Version
		if err := svc.Suppliers.Update(r.Context(), sup); err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, sup)
	}
}

func deleteSupplier(svc *service.Service) http.HandlerFunc {
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
		if err := svc.Suppliers.Delete(r.Context(), tid, id); err != nil {
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

// --- Purchase Orders ---

type createPOReq struct {
	PONumber     string          `json:"po_number"`
	SupplierID   uuid.UUID       `json:"supplier_id"`
	Status       domain.POStatus `json:"status,omitempty"`
	OrderDate    *string         `json:"order_date,omitempty"`   // "YYYY-MM-DD"
	ExpectedDate *string         `json:"expected_date,omitempty"` // "YYYY-MM-DD"
	Notes        string          `json:"notes,omitempty"`
}

func createPurchaseOrder(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createPOReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.PONumber == "" {
			writeErr(w, 400, errors.New("po_number is required"))
			return
		}
		if req.SupplierID == uuid.Nil {
			writeErr(w, 400, errors.New("supplier_id is required"))
			return
		}
		if req.Status == "" {
			req.Status = domain.PODraft
		}

		// Extract created_by from JWT context — never from request body.
		var createdBy uuid.UUID
		if c, ok := libauth.FromCtx(r.Context()); ok {
			createdBy, _ = uuid.Parse(c.Subject)
		}

		po := &domain.PurchaseOrder{
			ID:         uuid.New(),
			TenantID:   tid,
			PONumber:   req.PONumber,
			SupplierID: req.SupplierID,
			Status:     req.Status,
			Notes:      req.Notes,
			CreatedBy:  createdBy,
			Version:    1,
		}
		if req.OrderDate != nil {
			if t, err := parseDate(*req.OrderDate); err == nil {
				po.OrderDate = &t
			}
		}
		if req.ExpectedDate != nil {
			if t, err := parseDate(*req.ExpectedDate); err == nil {
				po.ExpectedDate = &t
			}
		}
		if err := svc.PurchaseOrders.Create(r.Context(), po); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, po)
	}
}

func getPurchaseOrder(svc *service.Service) http.HandlerFunc {
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
		po, err := svc.PurchaseOrders.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, po)
	}
}

func listPurchaseOrders(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		q := r.URL.Query().Get("q")
		status := r.URL.Query().Get("status")
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		var supplierID *uuid.UUID
		if sStr := r.URL.Query().Get("supplier_id"); sStr != "" {
			if id, err := uuid.Parse(sStr); err == nil {
				supplierID = &id
			}
		}
		items, total, err := svc.PurchaseOrders.List(r.Context(), tid, store.ListPOOpts{
			Status: status, SupplierID: supplierID, Q: q, Limit: limit, Offset: offset,
		})
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updatePOReq struct {
	SupplierID   *uuid.UUID      `json:"supplier_id,omitempty"`
	Status       domain.POStatus `json:"status,omitempty"`
	OrderDate    *string         `json:"order_date,omitempty"`
	ExpectedDate *string         `json:"expected_date,omitempty"`
	Notes        string          `json:"notes,omitempty"`
	Version      int             `json:"version"`
}

func updatePurchaseOrder(svc *service.Service) http.HandlerFunc {
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
		var req updatePOReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		po, err := svc.PurchaseOrders.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		if req.SupplierID != nil {
			po.SupplierID = *req.SupplierID
		}
		if req.Status != "" {
			po.Status = req.Status
		}
		if req.Notes != "" {
			po.Notes = req.Notes
		}
		if req.OrderDate != nil {
			if t, err := parseDate(*req.OrderDate); err == nil {
				po.OrderDate = &t
			}
		}
		if req.ExpectedDate != nil {
			if t, err := parseDate(*req.ExpectedDate); err == nil {
				po.ExpectedDate = &t
			}
		}
		po.Version = req.Version
		if err := svc.PurchaseOrders.Update(r.Context(), po); err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, po)
	}
}

// --- PO Lines ---

type addPOLineReq struct {
	ItemID      uuid.UUID  `json:"item_id"`
	LineNo      int        `json:"line_no"`
	QtyOrdered  float64    `json:"qty_ordered"`
	UnitPrice   float64    `json:"unit_price,omitempty"`
	UomID       *uuid.UUID `json:"uom_id,omitempty"`
	Notes       string     `json:"notes,omitempty"`
}

func addPOLine(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		poID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req addPOLineReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.ItemID == uuid.Nil {
			writeErr(w, 400, errors.New("item_id is required"))
			return
		}
		if req.QtyOrdered <= 0 {
			writeErr(w, 400, errors.New("qty_ordered must be > 0"))
			return
		}
		l := &domain.POLine{
			ID:         uuid.New(),
			TenantID:   tid,
			POID:       poID,
			ItemID:     req.ItemID,
			LineNo:     req.LineNo,
			QtyOrdered: req.QtyOrdered,
			UnitPrice:  req.UnitPrice,
			UomID:      req.UomID,
			Notes:      req.Notes,
		}
		if err := svc.PurchaseOrders.AddLine(r.Context(), l); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, l)
	}
}

type updatePOLineReq struct {
	ItemID      *uuid.UUID `json:"item_id,omitempty"`
	LineNo      *int       `json:"line_no,omitempty"`
	QtyOrdered  *float64   `json:"qty_ordered,omitempty"`
	QtyReceived *float64   `json:"qty_received,omitempty"`
	UnitPrice   *float64   `json:"unit_price,omitempty"`
	UomID       *uuid.UUID `json:"uom_id,omitempty"`
	Notes       string     `json:"notes,omitempty"`
}

func updatePOLine(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		// We need the PO id to validate ownership and the line id to update.
		poID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		lineID, err := uuid.Parse(chi.URLParam(r, "lineId"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req updatePOLineReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		// Fetch existing lines to populate the patch target.
		lines, err := svc.PurchaseOrders.ListLines(r.Context(), tid, poID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		var found *domain.POLine
		for i := range lines {
			if lines[i].ID == lineID {
				found = &lines[i]
				break
			}
		}
		if found == nil {
			writeErr(w, 404, errors.New("line not found"))
			return
		}
		if req.ItemID != nil {
			found.ItemID = *req.ItemID
		}
		if req.LineNo != nil {
			found.LineNo = *req.LineNo
		}
		if req.QtyOrdered != nil {
			found.QtyOrdered = *req.QtyOrdered
		}
		if req.QtyReceived != nil {
			found.QtyReceived = *req.QtyReceived
		}
		if req.UnitPrice != nil {
			found.UnitPrice = *req.UnitPrice
		}
		if req.UomID != nil {
			found.UomID = req.UomID
		}
		if req.Notes != "" {
			found.Notes = req.Notes
		}
		if err := svc.PurchaseOrders.UpdateLine(r.Context(), found); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, found)
	}
}

func deletePOLine(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		lineID, err := uuid.Parse(chi.URLParam(r, "lineId"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		if err := svc.PurchaseOrders.DeleteLine(r.Context(), tid, lineID); err != nil {
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
