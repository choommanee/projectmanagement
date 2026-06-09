package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/pmplatform/services/sales-svc/internal/domain"
	"github.com/pmplatform/services/sales-svc/internal/service"
	"github.com/pmplatform/services/sales-svc/internal/store"
)

type createShipmentReq struct {
	Code            string                 `json:"code"`
	SOID            *uuid.UUID             `json:"so_id,omitempty"`
	CustomerID      *uuid.UUID             `json:"customer_id,omitempty"`
	ShipDate        *string                `json:"ship_date,omitempty"`
	Carrier         string                 `json:"carrier,omitempty"`
	TrackingNo      string                 `json:"tracking_no,omitempty"`
	DeliveryAddress string                 `json:"delivery_address,omitempty"`
	Status          domain.ShipmentStatus  `json:"status,omitempty"`
	Notes           string                 `json:"notes,omitempty"`
}

func createShipment(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createShipmentReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		s := &domain.Shipment{
			TenantID:        tid,
			Code:            req.Code,
			SOID:            req.SOID,
			CustomerID:      req.CustomerID,
			Carrier:         req.Carrier,
			TrackingNo:      req.TrackingNo,
			DeliveryAddress: req.DeliveryAddress,
			Status:          req.Status,
			Notes:           req.Notes,
		}
		if req.ShipDate != nil {
			if t, err := time.Parse("2006-01-02", *req.ShipDate); err == nil {
				s.ShipDate = &t
			}
		}
		if err := svc.Shipments.Create(r.Context(), s); err != nil {
			writeErr(w, 500, err)
			return
		}
		emitAudit(svc, r, "sales.shipment.create", "shipment", s.ID.String(), nil,
			map[string]any{"code": s.Code, "status": s.Status})
		writeJSON(w, 201, s)
	}
}

func getShipment(svc *service.Service) http.HandlerFunc {
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
		s, err := svc.Shipments.GetByID(r.Context(), tid, id)
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

func listShipments(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListShipmentOpts{
			Status: r.URL.Query().Get("status"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		items, total, err := svc.Shipments.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateShipmentReq struct {
	Status          domain.ShipmentStatus `json:"status,omitempty"`
	Carrier         string                `json:"carrier,omitempty"`
	TrackingNo      string                `json:"tracking_no,omitempty"`
	DeliveryAddress string                `json:"delivery_address,omitempty"`
	ShipDate        *string               `json:"ship_date,omitempty"`
	Notes           string                `json:"notes,omitempty"`
}

func updateShipment(svc *service.Service) http.HandlerFunc {
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
		cur, err := svc.Shipments.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		var req updateShipmentReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateShipmentInput{
			Status:          cur.Status,
			Carrier:         cur.Carrier,
			TrackingNo:      cur.TrackingNo,
			DeliveryAddress: cur.DeliveryAddress,
			ShipDate:        cur.ShipDate,
			Notes:           cur.Notes,
		}
		if req.Status != "" {
			in.Status = req.Status
		}
		if req.Carrier != "" {
			in.Carrier = req.Carrier
		}
		if req.TrackingNo != "" {
			in.TrackingNo = req.TrackingNo
		}
		if req.DeliveryAddress != "" {
			in.DeliveryAddress = req.DeliveryAddress
		}
		if req.Notes != "" {
			in.Notes = req.Notes
		}
		if req.ShipDate != nil {
			if t, err := time.Parse("2006-01-02", *req.ShipDate); err == nil {
				in.ShipDate = &t
			}
		}
		s, err := svc.Shipments.Update(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		emitAudit(svc, r, "sales.shipment.update", "shipment", id.String(),
			map[string]any{"status": cur.Status},
			map[string]any{"status": s.Status})
		writeJSON(w, 200, s)
	}
}

type updateShipmentStatusReq struct {
	Status domain.ShipmentStatus `json:"status"`
}

func updateShipmentStatus(svc *service.Service) http.HandlerFunc {
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
		var req updateShipmentStatusReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Status == "" {
			writeErr(w, 400, errors.New("status required"))
			return
		}
		s, err := svc.Shipments.UpdateStatus(r.Context(), tid, id, req.Status)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		emitAudit(svc, r, "sales.shipment.status", "shipment", id.String(), nil,
			map[string]any{"status": s.Status})
		writeJSON(w, 200, s)
	}
}

func deleteShipment(svc *service.Service) http.HandlerFunc {
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
		if err := svc.Shipments.Delete(r.Context(), tid, id); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		emitAudit(svc, r, "sales.shipment.delete", "shipment", id.String(), nil, nil)
		w.WriteHeader(204)
	}
}
