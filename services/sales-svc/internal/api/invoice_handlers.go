package api

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/pmplatform/services/sales-svc/internal/domain"
	"github.com/pmplatform/services/sales-svc/internal/service"
	"github.com/pmplatform/services/sales-svc/internal/store"
)

// vatRate is the default tax rate applied when deriving invoice totals from a
// sales order's lines (Thai VAT, 7%).
const vatRate = 0.07

func round2(v float64) float64 { return math.Round(v*100) / 100 }

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
		subtotal, tax, total := req.Subtotal, req.Tax, req.Total
		if req.SOID != nil {
			// Derive amounts from the source sales order's lines.
			so, err := svc.SalesOrders.GetByID(r.Context(), tid, *req.SOID)
			if err != nil {
				if errors.Is(err, domain.ErrNotFound) {
					writeErr(w, 400, errors.New("so_id references unknown sales order"))
					return
				}
				writeErr(w, 500, err)
				return
			}
			subtotal = 0
			for _, l := range so.Lines {
				subtotal += l.QtyOrdered * l.UnitPrice
			}
			tax = round2(subtotal * vatRate)
			total = round2(subtotal + tax)
		} else {
			// Standalone invoice: accept request amounts; derive total when omitted.
			if total == 0 {
				total = round2(subtotal + tax)
			}
		}
		inv := &domain.SalesInvoice{
			TenantID:   tid,
			Code:       req.Code,
			SOID:       req.SOID,
			CustomerID: req.CustomerID,
			Status:     req.Status,
			Subtotal:   subtotal,
			Tax:        tax,
			Total:      total,
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
		emitAudit(svc, r, "sales.invoice.create", "sales_invoice", inv.ID.String(), nil,
			map[string]any{"code": inv.Code, "status": inv.Status, "total": inv.Total})
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
		action := "sales.invoice.update"
		if req.Status != "" && req.Status != cur.Status {
			action = "sales.invoice.status"
		}
		emitAudit(svc, r, action, "sales_invoice", id.String(),
			map[string]any{"status": cur.Status},
			map[string]any{"status": inv.Status})
		writeJSON(w, 200, inv)
	}
}

func deleteInvoice(svc *service.Service) http.HandlerFunc {
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
		if err := svc.Invoices.Delete(r.Context(), tid, id); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		emitAudit(svc, r, "sales.invoice.delete", "sales_invoice", id.String(), nil, nil)
		w.WriteHeader(204)
	}
}
