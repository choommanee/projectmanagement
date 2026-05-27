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

type createInvoiceReq struct {
	Code       string                `json:"code"`
	SOID       *uuid.UUID            `json:"so_id,omitempty"`
	CustomerID uuid.UUID             `json:"customer_id"`
	IssueDate  *string               `json:"issue_date,omitempty"`
	DueDate    *string               `json:"due_date,omitempty"`
	Status     domain.InvoiceStatus  `json:"status,omitempty"`
	Subtotal   float64               `json:"subtotal,omitempty"`
	Tax        float64               `json:"tax,omitempty"`
	Total      float64               `json:"total,omitempty"`
	Notes      string                `json:"notes,omitempty"`
}

func createInvoice(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createInvoiceReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.CustomerID == uuid.Nil {
			writeErr(w, 400, errors.New("customer_id required"))
			return
		}
		inv := &domain.SalesInvoice{
			TenantID:   tid,
			Code:       req.Code,
			SOID:       req.SOID,
			CustomerID: req.CustomerID,
			Status:     req.Status,
			Subtotal:   req.Subtotal,
			Tax:        req.Tax,
			Total:      req.Total,
			Notes:      req.Notes,
		}
		if req.IssueDate != nil {
			if t, err := time.Parse("2006-01-02", *req.IssueDate); err == nil {
				inv.IssueDate = t
			}
		}
		if req.DueDate != nil {
			if t, err := time.Parse("2006-01-02", *req.DueDate); err == nil {
				inv.DueDate = &t
			}
		}
		if err := svc.Invoices.Create(r.Context(), inv); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, inv)
	}
}

func getInvoice(svc *service.Service) http.HandlerFunc {
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
		inv, err := svc.Invoices.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, inv)
	}
}

func listInvoices(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListInvoiceOpts{
			Status: r.URL.Query().Get("status"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		if s := r.URL.Query().Get("customer_id"); s != "" {
			if id, err := uuid.Parse(s); err == nil {
				opts.CustomerID = &id
			}
		}
		items, total, err := svc.Invoices.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateInvoiceReq struct {
	Status   domain.InvoiceStatus `json:"status,omitempty"`
	DueDate  *string              `json:"due_date,omitempty"`
	Subtotal *float64             `json:"subtotal,omitempty"`
	Tax      *float64             `json:"tax,omitempty"`
	Total    *float64             `json:"total,omitempty"`
	Notes    string               `json:"notes,omitempty"`
	Version  int                  `json:"version"`
}

func updateInvoice(svc *service.Service) http.HandlerFunc {
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
		cur, err := svc.Invoices.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		var req updateInvoiceReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateInvoiceInput{
			Status:   cur.Status,
			DueDate:  cur.DueDate,
			Subtotal: cur.Subtotal,
			Tax:      cur.Tax,
			Total:    cur.Total,
			Notes:    cur.Notes,
			Version:  req.Version,
		}
		if req.Status != "" {
			in.Status = req.Status
		}
		if req.Notes != "" {
			in.Notes = req.Notes
		}
		if req.Subtotal != nil {
			in.Subtotal = *req.Subtotal
		}
		if req.Tax != nil {
			in.Tax = *req.Tax
		}
		if req.Total != nil {
			in.Total = *req.Total
		}
		if req.DueDate != nil {
			if t, err := time.Parse("2006-01-02", *req.DueDate); err == nil {
				in.DueDate = &t
			}
		}
		inv, err := svc.Invoices.Update(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, inv)
	}
}
