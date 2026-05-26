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

	"github.com/pmplatform/services/sales-svc/internal/domain"
	"github.com/pmplatform/services/sales-svc/internal/service"
	"github.com/pmplatform/services/sales-svc/internal/store"
)

var initURLParam = sync.OnceFunc(func() {
	libauth.URLParam = chi.URLParam
})

// NewRouter wires the sales-svc HTTP surface.
// authz is the Cedar-backed authorizer used to gate write endpoints.
// When nil the RequireAction middleware becomes a no-op.
func NewRouter(svc *service.Service, authz libauth.Authorizer) http.Handler {
	initURLParam()

	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})

	r.Route("/v1", func(r chi.Router) {
		// Customers
		r.Get("/customers", listCustomers(svc))
		r.With(libauth.RequireAction(authz, "sales.customer.create", "*")).Post("/customers", createCustomer(svc))
		r.Get("/customers/{id}", getCustomer(svc))
		r.With(libauth.RequireAction(authz, "sales.customer.update", "*")).Patch("/customers/{id}", updateCustomer(svc))
		r.With(libauth.RequireAction(authz, "sales.customer.delete", "*")).Delete("/customers/{id}", deleteCustomer(svc))

		// Sales Orders
		r.Get("/sales-orders", listSalesOrders(svc))
		r.With(libauth.RequireAction(authz, "sales.order.create", "*")).Post("/sales-orders", createSalesOrder(svc))
		r.Get("/sales-orders/{id}", getSalesOrder(svc))
		r.With(libauth.RequireAction(authz, "sales.order.update", "*")).Patch("/sales-orders/{id}", updateSalesOrder(svc))

		// SO Lines
		r.With(libauth.RequireAction(authz, "sales.order.update", "*")).Post("/sales-orders/{id}/lines", addSOLine(svc))
		r.With(libauth.RequireAction(authz, "sales.order.update", "*")).Patch("/sales-orders/{id}/lines/{lineId}", updateSOLine(svc))
		r.With(libauth.RequireAction(authz, "sales.order.update", "*")).Delete("/sales-orders/{id}/lines/{lineId}", deleteSOLine(svc))
	})

	return r
}

func tenantOr400(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	raw := r.Header.Get("X-Tenant-Id")
	tid, err := uuid.Parse(raw)
	if err != nil {
		writeErr(w, 400, errors.New("X-Tenant-Id required"))
		return uuid.Nil, false
	}
	return tid, true
}

// ---- Customers ----

type createCustomerReq struct {
	Code           string `json:"code"`
	Name           string `json:"name"`
	Contact        string `json:"contact,omitempty"`
	Email          string `json:"email,omitempty"`
	Phone          string `json:"phone,omitempty"`
	BillingAddress string `json:"billing_address,omitempty"`
	Active         *bool  `json:"active,omitempty"`
}

func createCustomer(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createCustomerReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Code == "" || req.Name == "" {
			writeErr(w, 400, errors.New("code and name required"))
			return
		}
		active := true
		if req.Active != nil {
			active = *req.Active
		}
		c := &domain.Customer{
			TenantID:       tid,
			Code:           req.Code,
			Name:           req.Name,
			Contact:        req.Contact,
			Email:          req.Email,
			Phone:          req.Phone,
			BillingAddress: req.BillingAddress,
			Active:         active,
		}
		if err := svc.Customers.Create(r.Context(), c); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, c)
	}
}

func getCustomer(svc *service.Service) http.HandlerFunc {
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
		c, err := svc.Customers.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, c)
	}
}

func listCustomers(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListCustomerOpts{
			Query:  r.URL.Query().Get("q"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		items, total, err := svc.Customers.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateCustomerReq struct {
	Name           string `json:"name,omitempty"`
	Contact        string `json:"contact,omitempty"`
	Email          string `json:"email,omitempty"`
	Phone          string `json:"phone,omitempty"`
	BillingAddress string `json:"billing_address,omitempty"`
	Active         *bool  `json:"active,omitempty"`
	Version        int    `json:"version"`
}

func updateCustomer(svc *service.Service) http.HandlerFunc {
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
		cur, err := svc.Customers.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		var req updateCustomerReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateCustomerInput{
			Name:           cur.Name,
			Contact:        cur.Contact,
			Email:          cur.Email,
			Phone:          cur.Phone,
			BillingAddress: cur.BillingAddress,
			Active:         cur.Active,
			Version:        req.Version,
		}
		if req.Name != "" {
			in.Name = req.Name
		}
		if req.Contact != "" {
			in.Contact = req.Contact
		}
		if req.Email != "" {
			in.Email = req.Email
		}
		if req.Phone != "" {
			in.Phone = req.Phone
		}
		if req.BillingAddress != "" {
			in.BillingAddress = req.BillingAddress
		}
		if req.Active != nil {
			in.Active = *req.Active
		}
		c, err := svc.Customers.Update(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, c)
	}
}

func deleteCustomer(svc *service.Service) http.HandlerFunc {
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
		if err := svc.Customers.Delete(r.Context(), tid, id, version); err != nil {
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

// ---- Sales Orders ----

type createSOReq struct {
	SONumber      string  `json:"so_number"`
	CustomerID    uuid.UUID `json:"customer_id"`
	Status        domain.SOStatus `json:"status,omitempty"`
	OrderDate     *string `json:"order_date,omitempty"`
	RequestedDate *string `json:"requested_date,omitempty"`
	Notes         string  `json:"notes,omitempty"`
}

func createSalesOrder(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		// created_by from JWT claims — never from request body
		claims, hasClaims := libauth.FromCtx(r.Context())
		var createdBy uuid.UUID
		if hasClaims && claims != nil && claims.Subject != "" {
			if id, err := uuid.Parse(claims.Subject); err == nil {
				createdBy = id
			}
		}

		var req createSOReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.SONumber == "" {
			writeErr(w, 400, errors.New("so_number required"))
			return
		}
		if req.Status == "" {
			req.Status = domain.SOStatusDraft
		}
		so := &domain.SalesOrder{
			TenantID:   tid,
			SONumber:   req.SONumber,
			CustomerID: req.CustomerID,
			Status:     req.Status,
			OrderDate:  time.Now(),
			Notes:      req.Notes,
			CreatedBy:  createdBy,
		}
		if req.OrderDate != nil {
			if t, err := time.Parse("2006-01-02", *req.OrderDate); err == nil {
				so.OrderDate = t
			}
		}
		if req.RequestedDate != nil {
			if t, err := time.Parse("2006-01-02", *req.RequestedDate); err == nil {
				so.RequestedDate = &t
			}
		}
		if err := svc.SalesOrders.Create(r.Context(), so); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, so)
	}
}

func getSalesOrder(svc *service.Service) http.HandlerFunc {
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
		so, err := svc.SalesOrders.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, so)
	}
}

func listSalesOrders(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListSOOpts{
			Status: r.URL.Query().Get("status"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		if s := r.URL.Query().Get("customer_id"); s != "" {
			if id, err := uuid.Parse(s); err == nil {
				opts.CustomerID = &id
			}
		}
		items, total, err := svc.SalesOrders.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateSOReq struct {
	Status        domain.SOStatus `json:"status,omitempty"`
	Notes         string          `json:"notes,omitempty"`
	RequestedDate *string         `json:"requested_date,omitempty"`
	Version       int             `json:"version"`
}

func updateSalesOrder(svc *service.Service) http.HandlerFunc {
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
		cur, err := svc.SalesOrders.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		var req updateSOReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateSOInput{
			Status:        cur.Status,
			Notes:         cur.Notes,
			RequestedDate: cur.RequestedDate,
			Version:       req.Version,
		}
		if req.Status != "" {
			in.Status = req.Status
		}
		if req.Notes != "" {
			in.Notes = req.Notes
		}
		if req.RequestedDate != nil {
			if t, err := time.Parse("2006-01-02", *req.RequestedDate); err == nil {
				in.RequestedDate = &t
			}
		}
		so, err := svc.SalesOrders.Update(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, so)
	}
}

// ---- SO Lines ----

type addSOLineReq struct {
	ItemID     *uuid.UUID `json:"item_id,omitempty"`
	ItemDesc   string     `json:"item_desc,omitempty"`
	LineNo     int        `json:"line_no"`
	QtyOrdered float64    `json:"qty_ordered"`
	QtyShipped float64    `json:"qty_shipped,omitempty"`
	UnitPrice  float64    `json:"unit_price,omitempty"`
	Notes      string     `json:"notes,omitempty"`
}

func addSOLine(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		soID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req addSOLineReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.QtyOrdered <= 0 {
			writeErr(w, 400, errors.New("qty_ordered must be > 0"))
			return
		}
		line := &domain.SOLine{
			TenantID:   tid,
			SOID:       soID,
			ItemID:     req.ItemID,
			ItemDesc:   req.ItemDesc,
			LineNo:     req.LineNo,
			QtyOrdered: req.QtyOrdered,
			QtyShipped: req.QtyShipped,
			UnitPrice:  req.UnitPrice,
			Notes:      req.Notes,
		}
		if err := svc.SalesOrders.AddLine(r.Context(), line); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, line)
	}
}

func updateSOLine(svc *service.Service) http.HandlerFunc {
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
		var req addSOLineReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		line, err := svc.SalesOrders.UpdateLine(r.Context(), tid, lineID, store.UpdateSOLineInput{
			ItemDesc:   req.ItemDesc,
			LineNo:     req.LineNo,
			QtyOrdered: req.QtyOrdered,
			QtyShipped: req.QtyShipped,
			UnitPrice:  req.UnitPrice,
			Notes:      req.Notes,
		})
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, line)
	}
}

func deleteSOLine(svc *service.Service) http.HandlerFunc {
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
		if err := svc.SalesOrders.DeleteLine(r.Context(), tid, lineID); err != nil {
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

// ---- Helpers ----

func atoiOr(s string, def int) int {
	if v, err := strconv.Atoi(s); err == nil {
		return v
	}
	return def
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}
