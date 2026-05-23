package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/document-svc/internal/domain"
	"github.com/pmplatform/services/document-svc/internal/service"
	"github.com/pmplatform/services/document-svc/internal/store"
)

// initURLParam wires libauth.URLParam to chi.URLParam exactly once.
var initURLParam = sync.OnceFunc(func() {
	libauth.URLParam = chi.URLParam
})

// NewRouter wires the document-svc HTTP surface.
//
// authz is the Cedar-backed authorizer used to gate write endpoints. When
// nil the RequireAction middleware becomes a no-op (libs/go/auth contract),
// which is how the legacy unit tests keep working without minting JWTs. The
// dedicated cedar_*_test.go cases pass a real *libpolicy.Adapter to exercise
// the allow/deny grid against the shared bundle.
//
// Per-instance ABAC scoping (Plan #6 Task 6 Step 3): write routes with
// {id} use RequireActionScoped against the relevant Cedar entity. The
// CedarLoader resolves Document/Workspace/Comment/Template ids to their
// tenant_id + (where present) owner_user so the policy can express
// per-instance predicates.
func NewRouter(svc *service.Service, authz libauth.Authorizer) http.Handler {
	return NewRouterWithLoader(svc, authz, nil)
}

// NewRouterWithLoader wires document-svc with an optional Cedar loader.
func NewRouterWithLoader(svc *service.Service, authz libauth.Authorizer, loader libauth.ResourceLoader) http.Handler {
	initURLParam()
	var loaderOpts []libauth.ScopedOption
	if loader != nil {
		loaderOpts = append(loaderOpts, libauth.WithLoader(loader))
	}

	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})

	r.Route("/v1", func(r chi.Router) {
		// Workspaces
		r.Get("/workspaces", listWorkspaces(svc))
		// no resource id at create time — ABAC for create gates by context.tenant_id only
		r.With(libauth.RequireAction(authz, "document.workspace.ensure", "*")).Post("/workspaces", ensureWorkspace(svc))

		// Documents
		r.Get("/documents", listDocuments(svc))
		// no resource id at create time — ABAC for create gates by context.tenant_id only
		r.With(libauth.RequireAction(authz, "document.create", "*")).Post("/documents", createDocument(svc))
		r.Get("/documents/{id}", getDocument(svc))
		r.With(libauth.RequireActionScoped(authz, "document.update", "Document::{:id}", loaderOpts...)).Patch("/documents/{id}", patchDocument(svc))
		r.With(libauth.RequireActionScoped(authz, "document.delete", "Document::{:id}", loaderOpts...)).Delete("/documents/{id}", deleteDocument(svc))

		// Versions
		r.Get("/documents/{id}/versions", listVersions(svc))
		r.Get("/documents/{id}/versions/{rev}", getVersion(svc))
		r.With(libauth.RequireActionScoped(authz, "document.restore", "Document::{:id}", loaderOpts...)).Post("/documents/{id}/restore", restoreDocument(svc))

		// Comments under document — resource is the parent document.
		r.Get("/documents/{id}/comments", listComments(svc))
		r.With(libauth.RequireActionScoped(authz, "document.comment.create", "Document::{:id}", loaderOpts...)).Post("/documents/{id}/comments", createComment(svc))

		// Comments standalone (resolve/delete) — resource is the Comment.
		r.With(libauth.RequireActionScoped(authz, "document.comment.resolve", "Comment::{:id}", loaderOpts...)).Patch("/comments/{id}/resolve", resolveComment(svc))
		r.With(libauth.RequireActionScoped(authz, "document.comment.delete", "Comment::{:id}", loaderOpts...)).Delete("/comments/{id}", deleteComment(svc))

		// Templates
		r.Get("/templates", listTemplates(svc))
		// no resource id at create time — ABAC for create gates by context.tenant_id only
		r.With(libauth.RequireAction(authz, "document.template.create", "*")).Post("/templates", createTemplate(svc))
		r.Get("/templates/{id}", getTemplate(svc))
	})

	return r
}

// tenantOr400 parses the X-Tenant-Id header and returns the UUID or writes 400.
func tenantOr400(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	raw := r.Header.Get("X-Tenant-Id")
	tid, err := uuid.Parse(raw)
	if err != nil {
		writeErr(w, 400, errors.New("X-Tenant-Id required"))
		return uuid.Nil, false
	}
	return tid, true
}

// --- Workspaces ---

type ensureWorkspaceReq struct {
	ProjectID uuid.UUID            `json:"project_id"`
	Kind      domain.WorkspaceKind `json:"kind"`
	Name      string               `json:"name,omitempty"`
}

func ensureWorkspace(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req ensureWorkspaceReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		ws, err := svc.EnsureWorkspace(r.Context(), service.EnsureWorkspaceInput{
			TenantID:  tid,
			ProjectID: req.ProjectID,
			Kind:      req.Kind,
			Name:      req.Name,
		})
		if err != nil {
			switch {
			case errors.Is(err, domain.ErrInvalidInput):
				writeErr(w, 400, err)
			default:
				writeErr(w, 500, err)
			}
			return
		}
		writeJSON(w, 200, ws)
	}
}

func listWorkspaces(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		pidStr := r.URL.Query().Get("project_id")
		pid, err := uuid.Parse(pidStr)
		if err != nil {
			writeErr(w, 400, errors.New("project_id required"))
			return
		}
		items, err := svc.Workspaces.ListForProject(r.Context(), tid, pid)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
	}
}

// --- Documents ---

type createDocumentReq struct {
	WorkspaceID uuid.UUID           `json:"workspace_id"`
	ProjectID   uuid.UUID           `json:"project_id"`
	Type        domain.DocumentType `json:"type"`
	Title       string              `json:"title"`
	Body        map[string]any      `json:"body,omitempty"`
	OwnerID     *uuid.UUID          `json:"owner_id,omitempty"`
	Tags        []string            `json:"tags,omitempty"`
}

func createDocument(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createDocumentReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		d, err := svc.CreateDocument(r.Context(), service.CreateDocumentInput{
			TenantID:    tid,
			WorkspaceID: req.WorkspaceID,
			ProjectID:   req.ProjectID,
			Type:        req.Type,
			Title:       req.Title,
			Body:        req.Body,
			OwnerID:     req.OwnerID,
			Tags:        req.Tags,
		})
		if err != nil {
			switch {
			case errors.Is(err, domain.ErrInvalidInput):
				writeErr(w, 400, err)
			default:
				writeErr(w, 500, err)
			}
			return
		}
		writeJSON(w, 201, d)
	}
}

func getDocument(svc *service.Service) http.HandlerFunc {
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
		d, err := svc.Documents.GetByID(r.Context(), tid, id)
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

func listDocuments(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		q := r.URL.Query()
		opts := store.ListDocsOpts{
			Type:   q.Get("type"),
			Status: q.Get("status"),
			Q:      q.Get("q"),
		}
		opts.Limit, _ = strconv.Atoi(q.Get("limit"))
		opts.Offset, _ = strconv.Atoi(q.Get("offset"))
		if wsStr := q.Get("workspace_id"); wsStr != "" {
			if wid, err := uuid.Parse(wsStr); err == nil {
				opts.WorkspaceID = &wid
			}
		}
		if pidStr := q.Get("project_id"); pidStr != "" {
			if pid, err := uuid.Parse(pidStr); err == nil {
				opts.ProjectID = &pid
			}
		}
		items, total, err := svc.Documents.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type patchDocumentReq struct {
	Title    string                `json:"title,omitempty"`
	Body     map[string]any        `json:"body,omitempty"`
	Metadata map[string]any        `json:"metadata,omitempty"`
	Status   domain.DocumentStatus `json:"status,omitempty"`
	OwnerID  *uuid.UUID            `json:"owner_id,omitempty"`
	Tags     []string              `json:"tags,omitempty"`
	Version  int                   `json:"version"`
}

func patchDocument(svc *service.Service) http.HandlerFunc {
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
		var req patchDocumentReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		d, err := svc.Documents.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		if req.Title != "" {
			d.Title = req.Title
		}
		if req.Body != nil {
			d.Body = req.Body
		}
		if req.Metadata != nil {
			d.Metadata = req.Metadata
		}
		if req.Status != "" {
			d.Status = req.Status
		}
		if req.OwnerID != nil {
			d.OwnerID = req.OwnerID
		}
		if req.Tags != nil {
			d.Tags = req.Tags
		}
		d.Version = req.Version
		if err := svc.Documents.Update(r.Context(), d); err != nil {
			switch {
			case errors.Is(err, domain.ErrConflict):
				writeErr(w, 409, err)
			default:
				writeErr(w, 500, err)
			}
			return
		}
		writeJSON(w, 200, d)
	}
}

func deleteDocument(svc *service.Service) http.HandlerFunc {
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
		if err := svc.Documents.SoftDelete(r.Context(), tid, id, version); err != nil {
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

// --- Versions ---

func listVersions(svc *service.Service) http.HandlerFunc {
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
		items, err := svc.Documents.ListVersions(r.Context(), tid, id)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
	}
}

func getVersion(svc *service.Service) http.HandlerFunc {
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
		rev, err := strconv.Atoi(chi.URLParam(r, "rev"))
		if err != nil {
			writeErr(w, 400, errors.New("rev must be an integer"))
			return
		}
		v, err := svc.Documents.GetVersion(r.Context(), tid, id, rev)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, v)
	}
}

type restoreReq struct {
	Rev     int `json:"rev"`
	Version int `json:"version"`
}

func restoreDocument(svc *service.Service) http.HandlerFunc {
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
		var req restoreReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		d, err := svc.Documents.Restore(r.Context(), tid, id, req.Rev, req.Version)
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
		writeJSON(w, 200, d)
	}
}

// --- Comments ---

type createCommentReq struct {
	Body     string         `json:"body"`
	ParentID *uuid.UUID     `json:"parent_id,omitempty"`
	AuthorID *uuid.UUID     `json:"author_id,omitempty"`
	Anchor   map[string]any `json:"anchor,omitempty"`
}

func createComment(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		docID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req createCommentReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		c, err := svc.CreateComment(r.Context(), service.CreateCommentInput{
			TenantID:   tid,
			DocumentID: docID,
			ParentID:   req.ParentID,
			AuthorID:   req.AuthorID,
			Body:       req.Body,
			Anchor:     req.Anchor,
		})
		if err != nil {
			switch {
			case errors.Is(err, domain.ErrInvalidInput):
				writeErr(w, 400, err)
			default:
				writeErr(w, 500, err)
			}
			return
		}
		writeJSON(w, 201, c)
	}
}

func listComments(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		docID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		items, err := svc.Comments.ListForDocument(r.Context(), tid, docID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
	}
}

func resolveComment(svc *service.Service) http.HandlerFunc {
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
		if err := svc.Comments.Resolve(r.Context(), tid, id); err != nil {
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

func deleteComment(svc *service.Service) http.HandlerFunc {
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
		if err := svc.Comments.Delete(r.Context(), tid, id); err != nil {
			writeErr(w, 500, err)
			return
		}
		w.WriteHeader(204)
	}
}

// --- Templates ---

type createTemplateReq struct {
	Type     domain.DocumentType `json:"type"`
	Name     string              `json:"name"`
	Body     map[string]any      `json:"body,omitempty"`
	IsSystem bool                `json:"is_system,omitempty"`
}

func createTemplate(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createTemplateReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		t, err := svc.CreateTemplate(r.Context(), service.CreateTemplateInput{
			TenantID: tid,
			Type:     req.Type,
			Name:     req.Name,
			Body:     req.Body,
			IsSystem: req.IsSystem,
		})
		if err != nil {
			switch {
			case errors.Is(err, domain.ErrInvalidInput):
				writeErr(w, 400, err)
			default:
				writeErr(w, 500, err)
			}
			return
		}
		writeJSON(w, 201, t)
	}
}

func listTemplates(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		typeStr := r.URL.Query().Get("type")
		var items []*domain.Template
		var err error
		if typeStr != "" {
			items, err = svc.Templates.ListByType(r.Context(), tid, domain.DocumentType(typeStr))
		} else {
			items, err = svc.Templates.ListAll(r.Context(), tid)
		}
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
	}
}

func getTemplate(svc *service.Service) http.HandlerFunc {
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
		t, err := svc.Templates.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, t)
	}
}

// --- Helpers ---

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}
