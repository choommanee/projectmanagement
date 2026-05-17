package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/pmplatform/services/tenant-svc/internal/domain"
	"github.com/pmplatform/services/tenant-svc/internal/service"
)

func NewRouter(svc *service.Service) http.Handler {
	r := chi.NewRouter()
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	r.Route("/v1/tenants", func(r chi.Router) {
		r.Post("/", create(svc))
		r.Get("/{id}", get(svc))
		r.Get("/by-slug/{slug}", getBySlug(svc))
	})
	return r
}

type createReq struct {
	Slug   string      `json:"slug"`
	Name   string      `json:"name"`
	Tier   domain.Tier `json:"tier,omitempty"`
	Region string      `json:"region,omitempty"`
}

func create(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in createReq
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		t, err := svc.Create(r.Context(), service.CreateInput{
			Slug: in.Slug, Name: in.Name, Tier: in.Tier, Region: in.Region,
		})
		if err != nil {
			switch {
			case errors.Is(err, domain.ErrInvalidSlug), errors.Is(err, domain.ErrInvalidName):
				writeErr(w, http.StatusBadRequest, err)
			default:
				writeErr(w, http.StatusInternalServerError, err)
			}
			return
		}
		writeJSON(w, http.StatusCreated, t)
	}
}

func get(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		t, err := svc.Get(r.Context(), id)
		if errors.Is(err, domain.ErrNotFound) {
			writeErr(w, 404, err)
			return
		}
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, t)
	}
}

func getBySlug(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		t, err := svc.GetBySlug(r.Context(), chi.URLParam(r, "slug"))
		if errors.Is(err, domain.ErrNotFound) {
			writeErr(w, 404, err)
			return
		}
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, t)
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
