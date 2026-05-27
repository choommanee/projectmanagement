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

type createOpportunityReq struct {
	Title             string                   `json:"title"`
	CustomerID        uuid.UUID                `json:"customer_id"`
	Stage             domain.OpportunityStage  `json:"stage,omitempty"`
	Value             float64                  `json:"value,omitempty"`
	Currency          string                   `json:"currency,omitempty"`
	ExpectedCloseDate *string                  `json:"expected_close_date,omitempty"`
	Probability       int                      `json:"probability,omitempty"`
	AssignedTo        *uuid.UUID               `json:"assigned_to,omitempty"`
	Notes             string                   `json:"notes,omitempty"`
}

func createOpportunity(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createOpportunityReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Title == "" {
			writeErr(w, 400, errors.New("title required"))
			return
		}
		o := &domain.Opportunity{
			TenantID:    tid,
			Title:       req.Title,
			CustomerID:  req.CustomerID,
			Stage:       req.Stage,
			Value:       req.Value,
			Currency:    req.Currency,
			Probability: req.Probability,
			AssignedTo:  req.AssignedTo,
			Notes:       req.Notes,
		}
		if req.ExpectedCloseDate != nil {
			if t, err := time.Parse("2006-01-02", *req.ExpectedCloseDate); err == nil {
				o.ExpectedCloseDate = &t
			}
		}
		if err := svc.Opportunities.Create(r.Context(), o); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, o)
	}
}

func getOpportunity(svc *service.Service) http.HandlerFunc {
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
		o, err := svc.Opportunities.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, o)
	}
}

func listOpportunities(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListOpportunityOpts{
			Stage:  r.URL.Query().Get("stage"),
			Limit:  atoiOr(r.URL.Query().Get("limit"), 100),
			Offset: atoiOr(r.URL.Query().Get("offset"), 0),
		}
		if s := r.URL.Query().Get("customer_id"); s != "" {
			if id, err := uuid.Parse(s); err == nil {
				opts.CustomerID = &id
			}
		}
		items, total, err := svc.Opportunities.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateOpportunityReq struct {
	Title             string                  `json:"title,omitempty"`
	Stage             domain.OpportunityStage `json:"stage,omitempty"`
	Value             *float64                `json:"value,omitempty"`
	Currency          string                  `json:"currency,omitempty"`
	ExpectedCloseDate *string                 `json:"expected_close_date,omitempty"`
	Probability       *int                    `json:"probability,omitempty"`
	AssignedTo        *uuid.UUID              `json:"assigned_to,omitempty"`
	Notes             string                  `json:"notes,omitempty"`
}

func updateOpportunity(svc *service.Service) http.HandlerFunc {
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
		cur, err := svc.Opportunities.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		var req updateOpportunityReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		in := store.UpdateOpportunityInput{
			Title:             cur.Title,
			Stage:             cur.Stage,
			Value:             cur.Value,
			Currency:          cur.Currency,
			ExpectedCloseDate: cur.ExpectedCloseDate,
			Probability:       cur.Probability,
			AssignedTo:        cur.AssignedTo,
			Notes:             cur.Notes,
		}
		if req.Title != "" {
			in.Title = req.Title
		}
		if req.Stage != "" {
			in.Stage = req.Stage
		}
		if req.Value != nil {
			in.Value = *req.Value
		}
		if req.Currency != "" {
			in.Currency = req.Currency
		}
		if req.Probability != nil {
			in.Probability = *req.Probability
		}
		if req.AssignedTo != nil {
			in.AssignedTo = req.AssignedTo
		}
		if req.Notes != "" {
			in.Notes = req.Notes
		}
		if req.ExpectedCloseDate != nil {
			if t, err := time.Parse("2006-01-02", *req.ExpectedCloseDate); err == nil {
				in.ExpectedCloseDate = &t
			}
		}
		o, err := svc.Opportunities.Update(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, o)
	}
}
