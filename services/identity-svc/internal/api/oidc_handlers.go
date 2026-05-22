package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/identity-svc/internal/domain"
	"github.com/pmplatform/services/identity-svc/internal/service"
)

// ssoCreate handles POST /v1/admin/sso/configs. The tenant_id is derived
// from the authenticated principal's JWT claims — admins cannot create a
// config under a tenant they're not a member of.
func ssoCreate(svc *service.OIDC) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, ok := libauth.FromCtx(r.Context())
		if !ok {
			writeErr(w, http.StatusUnauthorized, errors.New("no claims"))
			return
		}
		tid, err := uuid.Parse(c.TenantID)
		if err != nil {
			writeErr(w, http.StatusBadRequest, errors.New("bad tenant in claims"))
			return
		}
		var in service.OIDCConfigInput
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		resp, err := svc.CreateConfig(r.Context(), tid, in)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, http.StatusCreated, resp)
	}
}

// ssoUpdate handles PATCH /v1/admin/sso/configs/{id}.
func ssoUpdate(svc *service.OIDC) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, ok := libauth.FromCtx(r.Context())
		if !ok {
			writeErr(w, http.StatusUnauthorized, errors.New("no claims"))
			return
		}
		tid, err := uuid.Parse(c.TenantID)
		if err != nil {
			writeErr(w, http.StatusBadRequest, errors.New("bad tenant in claims"))
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, http.StatusBadRequest, errors.New("bad id"))
			return
		}
		var in service.OIDCConfigPatch
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		resp, err := svc.UpdateConfig(r.Context(), tid, id, in)
		if err != nil {
			if errors.Is(err, domain.ErrSSOConfigNotFound) {
				writeErr(w, http.StatusNotFound, err)
				return
			}
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

// ssoDelete handles DELETE /v1/admin/sso/configs/{id}.
func ssoDelete(svc *service.OIDC) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, ok := libauth.FromCtx(r.Context())
		if !ok {
			writeErr(w, http.StatusUnauthorized, errors.New("no claims"))
			return
		}
		tid, err := uuid.Parse(c.TenantID)
		if err != nil {
			writeErr(w, http.StatusBadRequest, errors.New("bad tenant in claims"))
			return
		}
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, http.StatusBadRequest, errors.New("bad id"))
			return
		}
		if err := svc.DeleteConfig(r.Context(), tid, id); err != nil {
			if errors.Is(err, domain.ErrSSOConfigNotFound) {
				writeErr(w, http.StatusNotFound, err)
				return
			}
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	}
}

// ssoList handles GET /v1/admin/sso/configs.
func ssoList(svc *service.OIDC) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, ok := libauth.FromCtx(r.Context())
		if !ok {
			writeErr(w, http.StatusUnauthorized, errors.New("no claims"))
			return
		}
		tid, err := uuid.Parse(c.TenantID)
		if err != nil {
			writeErr(w, http.StatusBadRequest, errors.New("bad tenant in claims"))
			return
		}
		rows, err := svc.ListConfigs(r.Context(), tid)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": rows})
	}
}

// oidcStart handles GET /v1/auth/oidc/{tenant_slug}/start?provider=<id>.
// Anonymous — returns a 302 to the IdP's authorize endpoint.
func oidcStart(svc *service.OIDC) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "tenant_slug")
		provider := r.URL.Query().Get("provider")
		redirectAfter := r.URL.Query().Get("redirect_after")
		if slug == "" || provider == "" {
			writeErr(w, http.StatusBadRequest, errors.New("tenant_slug and provider required"))
			return
		}
		res, err := svc.Start(r.Context(), slug, provider, redirectAfter)
		if err != nil {
			if errors.Is(err, domain.ErrSSOConfigNotFound) || errors.Is(err, domain.ErrNotFound) {
				writeErr(w, http.StatusNotFound, err)
				return
			}
			writeErr(w, http.StatusBadRequest, err)
			return
		}
		http.Redirect(w, r, res.RedirectURL, http.StatusFound)
	}
}

// oidcCallback handles GET /v1/auth/oidc/{tenant_slug}/callback. Anonymous.
//
// Content negotiation:
//   * Accept: application/json → JSON token pair body.
//   * Otherwise              → 302 to ${WEB_URL}/auth/complete?access=...&refresh=...
func oidcCallback(svc *service.OIDC) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "tenant_slug")
		code := r.URL.Query().Get("code")
		state := r.URL.Query().Get("state")
		if slug == "" || code == "" || state == "" {
			writeErr(w, http.StatusBadRequest, errors.New("tenant_slug, code, state required"))
			return
		}
		res, err := svc.Callback(r.Context(), slug, code, state)
		if err != nil {
			switch {
			case errors.Is(err, domain.ErrSSOStateInvalid):
				writeErr(w, http.StatusBadRequest, err)
			case errors.Is(err, domain.ErrSSOJITDisabled):
				writeErr(w, http.StatusForbidden, err)
			case errors.Is(err, domain.ErrSSOConfigNotFound), errors.Is(err, domain.ErrNotFound):
				writeErr(w, http.StatusNotFound, err)
			case errors.Is(err, domain.ErrSSOIDTokenInvalid), errors.Is(err, domain.ErrSSOMissingEmail):
				writeErr(w, http.StatusUnauthorized, err)
			default:
				writeErr(w, http.StatusInternalServerError, err)
			}
			return
		}
		if wantsJSON(r) {
			writeJSON(w, http.StatusOK, res.Tokens)
			return
		}
		http.Redirect(w, r, svc.BuildCompleteRedirect(res.RedirectAfter, res.Tokens), http.StatusFound)
	}
}

func wantsJSON(r *http.Request) bool {
	a := r.Header.Get("Accept")
	return strings.Contains(strings.ToLower(a), "application/json")
}
