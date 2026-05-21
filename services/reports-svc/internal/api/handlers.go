package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/pmplatform/services/reports-svc/internal/domain"
	"github.com/pmplatform/services/reports-svc/internal/service"
	"github.com/pmplatform/services/reports-svc/internal/store"
)

func NewRouter(svc *service.Service) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})

	r.Route("/v1", func(r chi.Router) {
		// Dashboards
		r.Get("/dashboards", listDashboards(svc))
		r.Post("/dashboards", createDashboard(svc))
		r.Get("/dashboards/{id}", getDashboard(svc))
		r.Patch("/dashboards/{id}", updateDashboard(svc))
		r.Delete("/dashboards/{id}", deleteDashboard(svc))

		// Metrics
		r.Get("/metrics/summary", getSummary(svc))
		r.Get("/metrics/timeseries", getTimeseries(svc))
		r.Get("/metrics/by-status", getByStatus(svc))
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

// --- Dashboards ---

func listDashboards(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		vis := r.URL.Query().Get("visibility")
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

		items, total, err := svc.ListDashboards(r.Context(), tid, store.ListDashboardsOpts{
			Visibility: vis, Limit: limit, Offset: offset,
		})
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		if items == nil {
			items = []*domain.DashboardFull{}
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

func getDashboard(svc *service.Service) http.HandlerFunc {
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
		d, err := svc.GetDashboard(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, d)
	}
}

type createDashboardReq struct {
	Name        string             `json:"name"`
	Description string             `json:"description,omitempty"`
	Visibility  domain.Visibility  `json:"visibility,omitempty"`
	Layout      json.RawMessage    `json:"layout,omitempty"`
	Widgets     json.RawMessage    `json:"widgets,omitempty"`
	IsPinned    bool               `json:"is_pinned,omitempty"`
}

func createDashboard(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createDashboardReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Name == "" {
			writeErr(w, 400, errors.New("name is required"))
			return
		}

		layout := []byte("[]")
		if req.Layout != nil {
			layout = req.Layout
		}
		widgets := []byte("[]")
		if req.Widgets != nil {
			widgets = req.Widgets
		}

		d, err := svc.CreateDashboard(r.Context(), store.CreateDashboardInput{
			TenantID:    tid,
			Name:        req.Name,
			Description: req.Description,
			Visibility:  req.Visibility,
			Layout:      layout,
			Widgets:     widgets,
			IsPinned:    req.IsPinned,
		})
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, d)
	}
}

type updateDashboardReq struct {
	Name        *string            `json:"name,omitempty"`
	Description *string            `json:"description,omitempty"`
	Visibility  *domain.Visibility `json:"visibility,omitempty"`
	Layout      json.RawMessage    `json:"layout,omitempty"`
	Widgets     json.RawMessage    `json:"widgets,omitempty"`
	IsPinned    *bool              `json:"is_pinned,omitempty"`
	Version     int                `json:"version"`
}

func updateDashboard(svc *service.Service) http.HandlerFunc {
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
		var req updateDashboardReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}

		in := store.UpdateDashboardInput{
			TenantID:    tid,
			ID:          id,
			Name:        req.Name,
			Description: req.Description,
			Visibility:  req.Visibility,
			IsPinned:    req.IsPinned,
			Version:     req.Version,
		}
		if req.Layout != nil {
			in.Layout = []byte(req.Layout)
		}
		if req.Widgets != nil {
			in.Widgets = []byte(req.Widgets)
		}

		d, err := svc.UpdateDashboard(r.Context(), in)
		if err != nil {
			switch {
			case errors.Is(err, domain.ErrConflict):
				writeErr(w, 409, err)
			case errors.Is(err, domain.ErrNotFound):
				writeErr(w, 404, err)
			default:
				writeErr(w, 500, err)
			}
			return
		}
		writeJSON(w, 200, d)
	}
}

func deleteDashboard(svc *service.Service) http.HandlerFunc {
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
		if err := svc.DeleteDashboard(r.Context(), tid, id, version); err != nil {
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

// --- Metrics ---

func getSummary(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		m, err := svc.GetSummary(r.Context(), tid)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, m)
	}
}

func getTimeseries(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		metric := r.URL.Query().Get("metric")
		days, _ := strconv.Atoi(r.URL.Query().Get("days"))
		if days <= 0 {
			days = 14
		}
		points, err := svc.GetTimeseries(r.Context(), tid, metric, days)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, points)
	}
}

func getByStatus(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		metric := r.URL.Query().Get("metric")
		points, err := svc.GetByStatus(r.Context(), tid, metric)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, points)
	}
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}
