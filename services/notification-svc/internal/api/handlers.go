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

	"github.com/pmplatform/services/notification-svc/internal/service"
	"github.com/pmplatform/services/notification-svc/internal/store"
)

// NewRouter wires the chi router for notification-svc.
// authz is the Cedar authorizer injected at boot; it is threaded through the
// router so future write endpoints can declare RequireAction guards inline.
func NewRouter(svc *service.Service, authz libauth.Authorizer) http.Handler {
	_ = authz // reserved for future per-route Cedar guards
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})

	r.Route("/v1", func(r chi.Router) {
		r.Get("/notifications", listNotifications(svc))
		r.Post("/notifications/read-all", markAllRead(svc))
		r.Post("/notifications/{id}/read", markRead(svc))
	})

	return r
}

// principalOr400 extracts X-Tenant-Id + X-User-Id headers.
func principalOr400(w http.ResponseWriter, r *http.Request) (tid, uid uuid.UUID, ok bool) {
	tid, err := uuid.Parse(r.Header.Get("X-Tenant-Id"))
	if err != nil {
		writeErr(w, 400, errors.New("X-Tenant-Id header required (UUID)"))
		return
	}
	uid, err = uuid.Parse(r.Header.Get("X-User-Id"))
	if err != nil {
		writeErr(w, 400, errors.New("X-User-Id header required (UUID)"))
		return
	}
	ok = true
	return
}

func listNotifications(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, uid, ok := principalOr400(w, r)
		if !ok {
			return
		}
		q := r.URL.Query()
		opts := store.ListOpts{
			UnreadOnly: q.Get("unread") == "true" || q.Get("unread") == "1",
			Limit:      atoiOr(q.Get("limit"), 50),
		}
		items, err := svc.List(r.Context(), tid, uid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items})
	}
}

func markRead(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, uid, ok := principalOr400(w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "id")
		if _, err := uuid.Parse(id); err != nil {
			writeErr(w, 400, errors.New("invalid notification id"))
			return
		}
		if err := svc.MarkRead(r.Context(), tid, uid, id); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeErr(w, 404, errors.New("not found"))
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok"})
	}
}

func markAllRead(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, uid, ok := principalOr400(w, r)
		if !ok {
			return
		}
		n, err := svc.MarkAllRead(r.Context(), tid, uid)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"updated": n})
	}
}

// ---- helpers ----

func atoiOr(s string, def int) int {
	if v, err := strconv.Atoi(s); err == nil && v > 0 {
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
