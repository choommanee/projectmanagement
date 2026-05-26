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

	"github.com/pmplatform/services/accounting-svc/internal/domain"
	"github.com/pmplatform/services/accounting-svc/internal/service"
	"github.com/pmplatform/services/accounting-svc/internal/store"
)

var initURLParam = sync.OnceFunc(func() {
	libauth.URLParam = chi.URLParam
})

// NewRouter wires the accounting-svc HTTP surface.
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
		// Chart of Accounts
		r.Get("/accounts", listAccounts(svc))
		r.With(libauth.RequireAction(authz, "accounting.account.create", "*")).Post("/accounts", createAccount(svc))
		r.Get("/accounts/{id}", getAccount(svc))
		r.With(libauth.RequireAction(authz, "accounting.account.update", "*")).Patch("/accounts/{id}", updateAccount(svc))
		r.With(libauth.RequireAction(authz, "accounting.account.delete", "*")).Delete("/accounts/{id}", deleteAccount(svc))

		// Journal Entries
		r.Get("/journal-entries", listJournalEntries(svc))
		r.With(libauth.RequireAction(authz, "accounting.je.create", "*")).Post("/journal-entries", createJournalEntry(svc))
		r.Get("/journal-entries/{id}", getJournalEntry(svc))
		r.With(libauth.RequireAction(authz, "accounting.je.update", "*")).Patch("/journal-entries/{id}", updateJournalEntry(svc))
		r.With(libauth.RequireAction(authz, "accounting.je.post", "*")).Post("/journal-entries/{id}/post", postJournalEntry(svc))

		// Journal Lines
		r.With(libauth.RequireAction(authz, "accounting.je.update", "*")).Post("/journal-entries/{id}/lines", addJournalLine(svc))
		r.With(libauth.RequireAction(authz, "accounting.je.update", "*")).Patch("/journal-entries/{id}/lines/{lineId}", updateJournalLine(svc))
		r.With(libauth.RequireAction(authz, "accounting.je.update", "*")).Delete("/journal-entries/{id}/lines/{lineId}", deleteJournalLine(svc))

		// Invoices
		r.Get("/invoices", listInvoices(svc))
		r.With(libauth.RequireAction(authz, "accounting.invoice.create", "*")).Post("/invoices", createInvoice(svc))
		r.Get("/invoices/{id}", getInvoice(svc))
		r.With(libauth.RequireAction(authz, "accounting.invoice.update", "*")).Patch("/invoices/{id}", updateInvoice(svc))
		r.With(libauth.RequireAction(authz, "accounting.invoice.delete", "*")).Delete("/invoices/{id}", deleteInvoice(svc))
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

func createdByFromCtx(r *http.Request) uuid.UUID {
	claims, hasClaims := libauth.FromCtx(r.Context())
	if hasClaims && claims != nil && claims.Subject != "" {
		if id, err := uuid.Parse(claims.Subject); err == nil {
			return id
		}
	}
	return uuid.Nil
}

// ---- Chart of Accounts ----

type createAccountReq struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	AccountType string `json:"account_type"`
	Currency    string `json:"currency,omitempty"`
	Active      *bool  `json:"active,omitempty"`
}

func createAccount(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createAccountReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Code == "" || req.Name == "" || req.AccountType == "" {
			writeErr(w, 400, errors.New("code, name and account_type required"))
			return
		}
		currency := "THB"
		if req.Currency != "" {
			currency = req.Currency
		}
		active := true
		if req.Active != nil {
			active = *req.Active
		}
		a := &domain.ChartOfAccount{
			TenantID:    tid,
			Code:        req.Code,
			Name:        req.Name,
			AccountType: req.AccountType,
			Currency:    currency,
			Active:      active,
		}
		if err := svc.Accounts.Create(r.Context(), a); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, a)
	}
}

func getAccount(svc *service.Service) http.HandlerFunc {
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
		a, err := svc.Accounts.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, a)
	}
}

func listAccounts(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListAccountOpts{
			Query:       r.URL.Query().Get("q"),
			AccountType: r.URL.Query().Get("type"),
			Limit:       atoiOr(r.URL.Query().Get("limit"), 100),
			Offset:      atoiOr(r.URL.Query().Get("offset"), 0),
		}
		items, total, err := svc.Accounts.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateAccountReq struct {
	Name        string `json:"name,omitempty"`
	AccountType string `json:"account_type,omitempty"`
	Currency    string `json:"currency,omitempty"`
	Active      *bool  `json:"active,omitempty"`
	Version     int    `json:"version"`
}

func updateAccount(svc *service.Service) http.HandlerFunc {
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
		cur, err := svc.Accounts.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		var req updateAccountReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateAccountInput{
			Name:        cur.Name,
			AccountType: cur.AccountType,
			Currency:    cur.Currency,
			Active:      cur.Active,
			Version:     req.Version,
		}
		if req.Name != "" {
			in.Name = req.Name
		}
		if req.AccountType != "" {
			in.AccountType = req.AccountType
		}
		if req.Currency != "" {
			in.Currency = req.Currency
		}
		if req.Active != nil {
			in.Active = *req.Active
		}
		a, err := svc.Accounts.Update(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, a)
	}
}

func deleteAccount(svc *service.Service) http.HandlerFunc {
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
		if err := svc.Accounts.Delete(r.Context(), tid, id, version); err != nil {
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

// ---- Journal Entries ----

type createJEReq struct {
	RefNo     string  `json:"ref_no"`
	Memo      string  `json:"memo,omitempty"`
	EntryDate *string `json:"entry_date,omitempty"`
}

func createJournalEntry(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		createdBy := createdByFromCtx(r)
		var req createJEReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.RefNo == "" {
			writeErr(w, 400, errors.New("ref_no required"))
			return
		}
		e := &domain.JournalEntry{
			TenantID:  tid,
			RefNo:     req.RefNo,
			Memo:      req.Memo,
			EntryDate: time.Now(),
			CreatedBy: createdBy,
		}
		if req.EntryDate != nil {
			if t, err := time.Parse("2006-01-02", *req.EntryDate); err == nil {
				e.EntryDate = t
			}
		}
		if err := svc.JournalEntries.Create(r.Context(), e); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, e)
	}
}

func getJournalEntry(svc *service.Service) http.HandlerFunc {
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
		e, err := svc.JournalEntries.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, e)
	}
}

func listJournalEntries(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListJEOpts{
			Status: r.URL.Query().Get("status"),
			From:   r.URL.Query().Get("from"),
			To:     r.URL.Query().Get("to"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		items, total, err := svc.JournalEntries.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateJEReq struct {
	Memo      string  `json:"memo,omitempty"`
	EntryDate *string `json:"entry_date,omitempty"`
	Version   int     `json:"version"`
}

func updateJournalEntry(svc *service.Service) http.HandlerFunc {
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
		cur, err := svc.JournalEntries.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		var req updateJEReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateJEInput{
			Memo:      cur.Memo,
			EntryDate: cur.EntryDate,
			Version:   req.Version,
		}
		if req.Memo != "" {
			in.Memo = req.Memo
		}
		if req.EntryDate != nil {
			if t, err := time.Parse("2006-01-02", *req.EntryDate); err == nil {
				in.EntryDate = t
			}
		}
		e, err := svc.JournalEntries.Update(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, e)
	}
}

type postJEReq struct {
	Version int `json:"version"`
}

func postJournalEntry(svc *service.Service) http.HandlerFunc {
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
		var req postJEReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		e, err := svc.JournalEntries.Post(r.Context(), tid, id, req.Version)
		if err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, e)
	}
}

// ---- Journal Lines ----

type addJELineReq struct {
	AccountID   uuid.UUID `json:"account_id"`
	Debit       float64   `json:"debit,omitempty"`
	Credit      float64   `json:"credit,omitempty"`
	Description string    `json:"description,omitempty"`
	LineNo      int       `json:"line_no"`
}

func addJournalLine(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		entryID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req addJELineReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.AccountID == uuid.Nil {
			writeErr(w, 400, errors.New("account_id required"))
			return
		}
		line := &domain.JournalLine{
			TenantID:    tid,
			EntryID:     entryID,
			AccountID:   req.AccountID,
			Debit:       req.Debit,
			Credit:      req.Credit,
			Description: req.Description,
			LineNo:      req.LineNo,
		}
		if err := svc.JournalEntries.AddLine(r.Context(), line); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, line)
	}
}

func updateJournalLine(svc *service.Service) http.HandlerFunc {
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
		var req addJELineReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		line, err := svc.JournalEntries.UpdateLine(r.Context(), tid, lineID, store.UpdateJELineInput{
			AccountID:   req.AccountID,
			Debit:       req.Debit,
			Credit:      req.Credit,
			Description: req.Description,
			LineNo:      req.LineNo,
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

func deleteJournalLine(svc *service.Service) http.HandlerFunc {
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
		if err := svc.JournalEntries.DeleteLine(r.Context(), tid, lineID); err != nil {
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

// ---- Invoices ----

type createInvoiceReq struct {
	InvNo          string     `json:"inv_no"`
	InvType        domain.InvType `json:"inv_type"`
	CounterpartyID *uuid.UUID `json:"counterparty_id,omitempty"`
	Amount         float64    `json:"amount"`
	Currency       string     `json:"currency,omitempty"`
	IssueDate      *string    `json:"issue_date,omitempty"`
	DueDate        *string    `json:"due_date,omitempty"`
	RefSOID        *uuid.UUID `json:"ref_so_id,omitempty"`
	RefPOID        *uuid.UUID `json:"ref_po_id,omitempty"`
	Notes          string     `json:"notes,omitempty"`
}

func createInvoice(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		createdBy := createdByFromCtx(r)
		var req createInvoiceReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.InvNo == "" || req.InvType == "" {
			writeErr(w, 400, errors.New("inv_no and inv_type required"))
			return
		}
		currency := "THB"
		if req.Currency != "" {
			currency = req.Currency
		}
		inv := &domain.Invoice{
			TenantID:       tid,
			InvNo:          req.InvNo,
			InvType:        req.InvType,
			CounterpartyID: req.CounterpartyID,
			Amount:         req.Amount,
			Currency:       currency,
			IssueDate:      time.Now(),
			RefSOID:        req.RefSOID,
			RefPOID:        req.RefPOID,
			Notes:          req.Notes,
			CreatedBy:      createdBy,
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
			InvType: r.URL.Query().Get("type"),
			Status:  r.URL.Query().Get("status"),
			Limit:   atoiOr(r.URL.Query().Get("limit"), 100),
			Offset:  atoiOr(r.URL.Query().Get("offset"), 0),
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
	Status  domain.InvStatus `json:"status,omitempty"`
	PaidAt  *string          `json:"paid_at,omitempty"`
	Notes   string           `json:"notes,omitempty"`
	Version int              `json:"version"`
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
			Status:  cur.Status,
			PaidAt:  cur.PaidAt,
			Notes:   cur.Notes,
			Version: req.Version,
		}
		if req.Status != "" {
			in.Status = req.Status
		}
		if req.Notes != "" {
			in.Notes = req.Notes
		}
		if req.PaidAt != nil {
			if t, err := time.Parse(time.RFC3339, *req.PaidAt); err == nil {
				in.PaidAt = &t
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
		version, _ := strconv.Atoi(r.URL.Query().Get("version"))
		if version <= 0 {
			writeErr(w, 400, errors.New("version query param required"))
			return
		}
		if err := svc.Invoices.Delete(r.Context(), tid, id, version); err != nil {
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
