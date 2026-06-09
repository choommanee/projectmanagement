package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/audit-svc/internal/service"
	"github.com/pmplatform/services/audit-svc/internal/store"
)

// NewRouter returns the chi router for audit-svc.
//
// authz is accepted for parity with other services (Plan #4 Task 3) even
// though audit-svc has zero WRITE_GUARD endpoints today — writes flow via
// NATS through audit-worker per ADR-0002. When future write endpoints (e.g.
// audit.export, audit.purge) land, wrap them with libauth.RequireAction.
func NewRouter(svc *service.Service, authz libauth.Authorizer) http.Handler {
	_ = authz // intentionally unused until a write route is added
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})

	r.Route("/v1", func(r chi.Router) {
		r.Get("/audit", listAudit(svc))
		r.Get("/audit/buckets", getBuckets(svc))
		r.Get("/audit/{id}", getAuditByID(svc))
	})

	return r
}

// tenantOr400 extracts and validates the X-Tenant-Id header.
func tenantOr400(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	raw := r.Header.Get("X-Tenant-Id")
	tid, err := uuid.Parse(raw)
	if err != nil {
		writeErr(w, 400, errors.New("X-Tenant-Id header required and must be a valid UUID"))
		return uuid.Nil, false
	}
	return tid, true
}

func listAudit(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		q := r.URL.Query()
		opts := store.ListOpts{
			Service:    q.Get("service"),
			Action:     q.Get("action"),
			EntityType: q.Get("entity_type"),
			EntityID:   q.Get("entity_id"),
			UserID:     q.Get("user_id"),
			Result:     q.Get("result"),
			Q:          q.Get("q"),
			From:       service.ParseTime(q.Get("from")),
			To:         service.ParseTimeUpper(q.Get("to")),
			Limit:      atoiOr(q.Get("limit"), 50),
			Offset:     atoiOr(q.Get("offset"), 0),
		}
		items, total, err := svc.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

func getAuditByID(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "id")
		ev, err := svc.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeErr(w, 404, errors.New("not found"))
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, ev)
	}
}

func getBuckets(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		days := atoiOr(r.URL.Query().Get("days"), 14)
		buckets, err := svc.Buckets(r.Context(), tid, days)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, buckets)
	}
}

// ---- helpers ----

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
