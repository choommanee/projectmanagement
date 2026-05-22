package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/tenant-svc/internal/domain"
	"github.com/pmplatform/services/tenant-svc/internal/service"
)

// initURLParam wires libauth.URLParam to chi.URLParam exactly once so the
// scoped authz middleware can resolve `{:id}` placeholders without forcing
// libs/go/auth to import chi.
var initURLParam = sync.OnceFunc(func() {
	libauth.URLParam = chi.URLParam
})

// NewRouter wires the tenant-svc HTTP surface.
//
// authz is the Cedar-backed authorizer used to gate write endpoints. When
// nil the RequireAction middleware becomes a no-op (libs/go/auth contract),
// which is how the legacy unit tests keep working without minting JWTs. The
// dedicated cedar_*_test.go cases pass a real *libpolicy.Adapter to exercise
// the allow/deny grid against the shared bundle.
//
// Per-instance ABAC scoping (Plan #6 Task 6 Step 3): write routes with an
// `{id}` path param now use RequireActionScoped(`Tenant::{:id}`) so Cedar
// receives a typed resource UID and the optional ResourceLoader can attach
// `tenant_id` / `owner_user` attributes from the service store.
//
// NewRouter keeps its legacy two-argument signature for backward compat
// (cedar_create_test.go calls it that way). NewRouterWithLoader is the
// preferred entrypoint for production wiring.
func NewRouter(svc *service.Service, authz libauth.Authorizer) http.Handler {
	return NewRouterWithLoader(svc, authz, nil)
}

// NewRouterWithLoader wires the tenant-svc router with an optional Cedar
// resource loader.
func NewRouterWithLoader(svc *service.Service, authz libauth.Authorizer, loader libauth.ResourceLoader) http.Handler {
	initURLParam()
	var loaderOpts []libauth.ScopedOption
	if loader != nil {
		loaderOpts = append(loaderOpts, libauth.WithLoader(loader))
	}
	r := chi.NewRouter()
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	r.Route("/v1/tenants", func(r chi.Router) {
		r.Get("/", list(svc))
		// no resource id at create time — ABAC for create gates by context.tenant_id only
		r.With(libauth.RequireAction(authz, "tenant.create", "*")).Post("/", create(svc))
		r.Get("/by-slug/{slug}", getBySlug(svc))
		r.Get("/{id}", get(svc))
		r.With(libauth.RequireActionScoped(authz, "tenant.update", "Tenant::{:id}", loaderOpts...)).Patch("/{id}", update(svc))
		r.With(libauth.RequireActionScoped(authz, "tenant.delete", "Tenant::{:id}", loaderOpts...)).Delete("/{id}", del(svc))
	})
	return r
}

func list(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("q")
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
		res, err := svc.List(r.Context(), service.ListInput{Q: q, Limit: limit, Offset: offset})
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": res.Items, "total": res.Total})
	}
}

type updateReq struct {
	Name    string        `json:"name,omitempty"`
	Tier    domain.Tier   `json:"tier,omitempty"`
	Status  domain.Status `json:"status,omitempty"`
	Region  string        `json:"region,omitempty"`
	Version int           `json:"version"`
}

func update(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var in updateReq
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, 400, err)
			return
		}
		t, err := svc.Update(r.Context(), service.UpdateInput{
			ID: id, Name: in.Name, Tier: in.Tier, Status: in.Status, Region: in.Region, Version: in.Version,
		})
		if err != nil {
			switch {
			case errors.Is(err, domain.ErrNotFound):
				writeErr(w, 404, err)
			case errors.Is(err, domain.ErrConflict):
				writeErr(w, 409, err)
			default:
				writeErr(w, 500, err)
			}
			return
		}
		writeJSON(w, 200, t)
	}
}

func del(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
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
		if err := svc.Delete(r.Context(), id, version); err != nil {
			switch {
			case errors.Is(err, domain.ErrConflict):
				writeErr(w, 409, err)
			default:
				writeErr(w, 500, err)
			}
			return
		}
		w.WriteHeader(204)
	}
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
