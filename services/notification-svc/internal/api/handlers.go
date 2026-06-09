package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/notification-svc/internal/domain"
	"github.com/pmplatform/services/notification-svc/internal/service"
	"github.com/pmplatform/services/notification-svc/internal/store"
)

// NewRouter wires the chi router for notification-svc.
// authz is the Cedar authorizer injected at boot.
// When authz is nil (tests that don't need Cedar), RequireAction becomes a
// no-op — that is the contract in libs/go/auth.
func NewRouter(svc *service.Service, authz libauth.Authorizer) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})

	r.Route("/v1", func(r chi.Router) {
		// GET /v1/notifications — Cedar action notif.read required per ADR-0002.
		r.With(libauth.RequireAction(authz, "notif.read", `Notification::"*"`)).
			Get("/notifications", listNotifications(svc))

		// POST /v1/notifications/read-all — no Cedar guard; RLS + user_id claim
		// from principalOr400 is the ownership gate (UPDATE WHERE tenant_id=$1
		// AND user_id=$2). Cedar wildcard resource would never satisfy the
		// resource.user_id == context.user_id attribute check → always 403.
		r.Post("/notifications/read-all", markAllRead(svc))

		// POST /v1/notifications/{id}/read — same reasoning as read-all.
		// The store UPDATE uses tenant_id + user_id + id so only the owning
		// user's row is touched; Cedar is redundant and broken for this route.
		r.Post("/notifications/{id}/read", markRead(svc))

		// GET/PUT /v1/notification-preferences — no Cedar guard; the rows are
		// scoped to (tenant_id, user_id) via principalOr400 + RLS, exactly like
		// the mark-read routes. A Cedar wildcard resource cannot express the
		// "owns this preference" check, so it would always deny.
		r.Get("/notification-preferences", listPreferences(svc))
		r.Put("/notification-preferences", putPreferences(svc))
	})

	return r
}

// principalOr400 extracts tenant and user identity from the JWT claims placed
// in context by the AttachClaims middleware. Returns HTTP 401 if claims are
// absent (unauthenticated) or 400 if the claim values are not valid UUIDs.
func principalOr400(w http.ResponseWriter, r *http.Request) (tid, uid uuid.UUID, ok bool) {
	claims, hasClaims := libauth.FromCtx(r.Context())
	if !hasClaims || claims == nil {
		writeErr(w, 401, errors.New("authentication required"))
		return
	}
	var err error
	tid, err = uuid.Parse(claims.TenantID)
	if err != nil {
		writeErr(w, 400, errors.New("tenant_id in token is not a valid UUID"))
		return
	}
	uid, err = uuid.Parse(claims.Subject)
	if err != nil {
		writeErr(w, 400, errors.New("subject in token is not a valid UUID"))
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
		total, err := svc.Count(r.Context(), tid, uid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
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

func listPreferences(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, uid, ok := principalOr400(w, r)
		if !ok {
			return
		}
		prefs, err := svc.ListPreferences(r.Context(), tid, uid)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"preferences": prefs})
	}
}

func putPreferences(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, uid, ok := principalOr400(w, r)
		if !ok {
			return
		}
		// Accept either a bare array [{kind,channels}] or {"preferences":[...]}.
		var prefs []domain.Preference
		raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			writeErr(w, 400, errors.New("cannot read body"))
			return
		}
		if err := json.Unmarshal(raw, &prefs); err != nil {
			var wrapped struct {
				Preferences []domain.Preference `json:"preferences"`
			}
			if err2 := json.Unmarshal(raw, &wrapped); err2 != nil {
				writeErr(w, 400, errors.New("body must be a JSON array of {kind, channels}"))
				return
			}
			prefs = wrapped.Preferences
		}
		for _, p := range prefs {
			if p.Kind == "" {
				writeErr(w, 400, errors.New("each preference requires a non-empty kind"))
				return
			}
		}
		if err := svc.SetPreferences(r.Context(), tid, uid, prefs); err != nil {
			writeErr(w, 500, err)
			return
		}
		// Echo back the persisted set so the client can confirm.
		saved, err := svc.ListPreferences(r.Context(), tid, uid)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"preferences": saved})
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
