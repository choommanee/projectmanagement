package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/sales-svc/internal/domain"
	"github.com/pmplatform/services/sales-svc/internal/service"
	"github.com/pmplatform/services/sales-svc/internal/store"
)

type createQuotationReq struct {
	Code        string                  `json:"code"`
	CustomerID  uuid.UUID               `json:"customer_id"`
	Title       string                  `json:"title"`
	ValidUntil  *string                 `json:"valid_until,omitempty"`
	Status      domain.QuotationStatus  `json:"status,omitempty"`
	TotalAmount float64                 `json:"total_amount,omitempty"`
	Notes       string                  `json:"notes,omitempty"`
}

func createQuotation(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createQuotationReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Title == "" {
			writeErr(w, 400, errors.New("title required"))
			return
		}
		q := &domain.Quotation{
			TenantID:    tid,
			Code:        req.Code,
			CustomerID:  req.CustomerID,
			Title:       req.Title,
			Status:      req.Status,
			TotalAmount: req.TotalAmount,
			Notes:       req.Notes,
		}
		if req.ValidUntil != nil {
			if t, err := time.Parse("2006-01-02", *req.ValidUntil); err == nil {
				q.ValidUntil = &t
			}
		}
		if err := svc.Quotations.Create(r.Context(), q); err != nil {
			writeErr(w, 500, err)
			return
		}
		emitAudit(svc, r, "sales.quotation.create", "quotation", q.ID.String(), nil,
			map[string]any{"code": q.Code, "title": q.Title, "status": q.Status})
		writeJSON(w, 201, q)
	}
}

func getQuotation(svc *service.Service) http.HandlerFunc {
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
		q, err := svc.Quotations.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, q)
	}
}

func listQuotations(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListQuotationOpts{
			Status: r.URL.Query().Get("status"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		if s := r.URL.Query().Get("customer_id"); s != "" {
			if id, err := uuid.Parse(s); err == nil {
				opts.CustomerID = &id
			}
		}
		items, total, err := svc.Quotations.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateQuotationReq struct {
	Title       string                 `json:"title,omitempty"`
	ValidUntil  *string                `json:"valid_until,omitempty"`
	Status      domain.QuotationStatus `json:"status,omitempty"`
	TotalAmount *float64               `json:"total_amount,omitempty"`
	Notes       string                 `json:"notes,omitempty"`
	Version     int                    `json:"version"`
}

func updateQuotation(svc *service.Service) http.HandlerFunc {
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
		cur, err := svc.Quotations.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		var req updateQuotationReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateQuotationInput{
			Title:       cur.Title,
			ValidUntil:  cur.ValidUntil,
			Status:      cur.Status,
			TotalAmount: cur.TotalAmount,
			Notes:       cur.Notes,
			Version:     req.Version,
		}
		if req.Title != "" {
			in.Title = req.Title
		}
		if req.Status != "" {
			in.Status = req.Status
		}
		if req.Notes != "" {
			in.Notes = req.Notes
		}
		if req.TotalAmount != nil {
			in.TotalAmount = *req.TotalAmount
		}
		if req.ValidUntil != nil {
			if t, err := time.Parse("2006-01-02", *req.ValidUntil); err == nil {
				in.ValidUntil = &t
			}
		}
		q, err := svc.Quotations.Update(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		emitAudit(svc, r, "sales.quotation.update", "quotation", id.String(),
			map[string]any{"status": cur.Status},
			map[string]any{"status": q.Status})
		writeJSON(w, 200, q)
	}
}

func deleteQuotation(svc *service.Service) http.HandlerFunc {
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
		if err := svc.Quotations.Delete(r.Context(), tid, id); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		emitAudit(svc, r, "sales.quotation.delete", "quotation", id.String(), nil, nil)
		w.WriteHeader(204)
	}
}

// convertQuotation creates a sales order from an existing quotation. The new
// order carries a single line derived from the quotation total so downstream
// invoices have non-zero amounts, and the source quotation is marked accepted.
func convertQuotation(svc *service.Service) http.HandlerFunc {
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
		var createdBy uuid.UUID
		if claims, has := libauth.FromCtx(r.Context()); has && claims != nil && claims.Subject != "" {
			if uid, perr := uuid.Parse(claims.Subject); perr == nil {
				createdBy = uid
			}
		}
		q, err := svc.Quotations.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		so := &domain.SalesOrder{
			TenantID:   tid,
			CustomerID: q.CustomerID,
			Status:     domain.SOStatusConfirmed,
			OrderDate:  time.Now(),
			Notes:      "Converted from quotation " + q.Code,
			CreatedBy:  createdBy,
		}
		if err := svc.SalesOrders.Create(r.Context(), so); err != nil {
			writeErr(w, 500, err)
			return
		}
		emitAudit(svc, r, "sales.order.create", "sales_order", so.ID.String(), nil,
			map[string]any{"status": so.Status, "converted_from_quotation": id.String()})
		if q.TotalAmount > 0 {
			line := &domain.SOLine{
				TenantID:   tid,
				SOID:       so.ID,
				ItemDesc:   q.Title,
				LineNo:     1,
				QtyOrdered: 1,
				UnitPrice:  q.TotalAmount,
			}
			if err := svc.SalesOrders.AddLine(r.Context(), line); err != nil {
				writeErr(w, 500, err)
				return
			}
		}
		// Mark the quotation accepted (best-effort optimistic update).
		_, _ = svc.Quotations.Update(r.Context(), tid, id, store.UpdateQuotationInput{
			Title:       q.Title,
			ValidUntil:  q.ValidUntil,
			Status:      domain.QuotationAccepted,
			TotalAmount: q.TotalAmount,
			Notes:       q.Notes,
			Version:     q.Version,
		})
		// Reload the order with its lines for the response.
		full, err := svc.SalesOrders.GetByID(r.Context(), tid, so.ID)
		if err != nil {
			writeJSON(w, 201, so)
			return
		}
		writeJSON(w, 201, full)
	}
}
