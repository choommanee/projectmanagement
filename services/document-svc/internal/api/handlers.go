package api

import (
	"encoding/base64"
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
		r.Get("/workspaces/{id}", getWorkspace(svc))
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
		r.With(libauth.RequireActionScoped(authz, "document.template.update", "Template::{:id}", loaderOpts...)).Patch("/templates/{id}", patchTemplate(svc))
		r.With(libauth.RequireActionScoped(authz, "document.template.delete", "Template::{:id}", loaderOpts...)).Delete("/templates/{id}", deleteTemplate(svc))

		// --- Tier-1 e-signature: envelopes ---
		r.With(libauth.RequireActionScoped(authz, "document.sign.envelope.create", "Document::{:id}", loaderOpts...)).
			Post("/documents/{id}/sign-envelopes", createEnvelope(svc))
		r.Get("/documents/{id}/sign-envelopes", listEnvelopesForDoc(svc))
		r.Get("/documents/{id}/sign-audit", docSignAudit(svc))
		r.Get("/documents/{id}/sign-certificate", docSignCertificate(svc))

		r.Get("/sign-envelopes/{id}", getEnvelope(svc))
		r.With(libauth.RequireActionScoped(authz, "document.sign.send", "SignEnvelope::{:id}", loaderOpts...)).
			Post("/sign-envelopes/{id}/send", sendEnvelope(svc))
		r.With(libauth.RequireActionScoped(authz, "document.sign.void", "SignEnvelope::{:id}", loaderOpts...)).
			Post("/sign-envelopes/{id}/void", voidEnvelope(svc))
		r.With(libauth.RequireActionScoped(authz, "document.sign.view", "SignEnvelope::{:id}", loaderOpts...)).
			Post("/sign-envelopes/{id}/signers/{signerId}/view", viewSigner(svc))
		r.With(libauth.RequireActionScoped(authz, "document.sign.sign", "SignEnvelope::{:id}", loaderOpts...)).
			Post("/sign-envelopes/{id}/signers/{signerId}/sign", signEnvelopeSigner(svc))
		// Email-OTP step-up: same Cedar posture as document.sign.sign — any
		// authenticated user passes; the service enforces actor == signer row.
		r.With(libauth.RequireActionScoped(authz, "document.sign.otp.request", "SignEnvelope::{:id}", loaderOpts...)).
			Post("/sign-envelopes/{id}/signers/{signerId}/otp/request", requestSignOTP(svc))
		r.With(libauth.RequireActionScoped(authz, "document.sign.decline", "SignEnvelope::{:id}", loaderOpts...)).
			Post("/sign-envelopes/{id}/signers/{signerId}/decline", declineEnvelopeSigner(svc))
		r.Get("/sign-envelopes/{id}/verify", verifyEnvelope(svc))
		r.Get("/sign-envelopes/{id}/audit", envelopeAudit(svc))
		r.Get("/sign-envelopes/{id}/certificate", envelopeCertificate(svc))

		// Trust layer (handlers_trust.go): platform cert download +
		// certificate-PDF signature verification — reads, same posture as
		// the verify route above.
		registerTrustRoutes(r, svc)

		// Admin: import an operator-provided X.509 document-signing certificate
		// (BYO cert) and read the active cert's metadata. platform-admin only
		// (Cedar action document.sign.cert.import, resource "*").
		r.With(libauth.RequireAction(authz, "document.sign.cert.import", "*")).
			Post("/admin/sign-cert", importSignCert(svc))
		r.With(libauth.RequireAction(authz, "document.sign.cert.import", "*")).
			Get("/admin/sign-cert", getActiveSignCert(svc))

		// Public verification links (handlers_public.go). Create + revoke
		// share one Cedar action (document.sign.verify_link.create —
		// tenant-admin / project-manager / workflow-service, mirroring
		// document.sign.send); list is an RLS-scoped read.
		r.With(libauth.RequireActionScoped(authz, "document.sign.verify_link.create", "SignEnvelope::{:id}", loaderOpts...)).
			Post("/sign-envelopes/{id}/verify-links", createVerifyLink(svc))
		r.Get("/sign-envelopes/{id}/verify-links", listVerifyLinks(svc))
		r.With(libauth.RequireActionScoped(authz, "document.sign.verify_link.create", "SignEnvelope::{:id}", loaderOpts...)).
			Delete("/sign-envelopes/{id}/verify-links/{linkId}", revokeVerifyLink(svc))

		// NOTE: the legacy /v1/documents/{id}/signatures* shim routes were
		// REMOVED (security hardening): they bypassed Cedar + claims entirely
		// and the FE migrated to the envelope routes above (SignaturePanel →
		// lib/api/signing.ts). Requests now 404.
	})

	// --- PUBLIC, UNAUTHENTICATED routes (handlers_public.go) ----------------
	// Mounted OUTSIDE the /v1 group and carrying NO RequireAction middleware:
	// the 256-bit share token in the path is the sole credential. Unknown,
	// revoked, and expired tokens all return an indistinguishable 404 via one
	// indexed lookup (cheap miss path).
	r.Get("/public/verify/{token}", publicVerify(svc))
	r.Get("/public/verify/{token}/certificate", publicVerifyCertificate(svc))

	return r
}

// auditMeta extracts request-scoped audit context (IP / UA / actor).
func auditMeta(r *http.Request) service.AuditMeta {
	ip := r.Header.Get("X-Forwarded-For")
	if ip == "" {
		ip = r.RemoteAddr
	} else if i := indexByte(ip, ','); i >= 0 {
		ip = ip[:i] // first hop
	}
	var actor *uuid.UUID
	if c, ok := libauth.FromCtx(r.Context()); ok && c != nil && c.Subject != "" {
		if a, err := uuid.Parse(c.Subject); err == nil {
			actor = &a
		}
	}
	return service.AuditMeta{
		IPAddress: ip,
		UserAgent: r.UserAgent(),
		Geo:       r.Header.Get("X-Geo"),
		ActorID:   actor,
	}
}

func indexByte(s string, b byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return i
		}
	}
	return -1
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
		auditWrite(svc, r, tid, "document.workspace.ensure", "workspace", ws.ID.String())
		writeJSON(w, 200, ws)
	}
}

func listWorkspaces(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		q := r.URL.Query()
		// When project_id is supplied, scope to that project (legacy contract).
		// When omitted, return all workspaces for the tenant — this powers the
		// cross-project Document Hub (workspaces list + hub dashboard), with an
		// optional kind filter and pagination.
		if pidStr := q.Get("project_id"); pidStr != "" {
			pid, err := uuid.Parse(pidStr)
			if err != nil {
				writeErr(w, 400, errors.New("project_id must be a valid uuid"))
				return
			}
			items, err := svc.Workspaces.ListForProject(r.Context(), tid, pid)
			if err != nil {
				writeErr(w, 500, err)
				return
			}
			writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
			return
		}
		limit, _ := strconv.Atoi(q.Get("limit"))
		offset, _ := strconv.Atoi(q.Get("offset"))
		items, total, err := svc.Workspaces.ListAll(r.Context(), tid, domain.WorkspaceKind(q.Get("kind")), limit, offset)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

func getWorkspace(svc *service.Service) http.HandlerFunc {
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
		ws, err := svc.Workspaces.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, ws)
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
		auditWrite(svc, r, tid, "document.create", "document", d.ID.String())
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
		if req.Status != "" && !req.Status.Valid() {
			writeErr(w, 400, errors.New("status must be one of draft, review, approved, archived"))
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
		auditWriteMeta(svc, r, tid, "document.update", "document", d.ID.String(),
			map[string]any{"status": string(d.Status)})
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
		auditWrite(svc, r, tid, "document.delete", "document", id.String())
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
		auditWriteMeta(svc, r, tid, "document.restore", "document", d.ID.String(),
			map[string]any{"rev": req.Rev})
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
		auditWriteMeta(svc, r, tid, "document.comment.create", "document_comment", c.ID.String(),
			map[string]any{"document_id": docID.String()})
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
		auditWrite(svc, r, tid, "document.comment.resolve", "document_comment", id.String())
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
		auditWrite(svc, r, tid, "document.comment.delete", "document_comment", id.String())
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
		auditWrite(svc, r, tid, "document.template.create", "document_template", t.ID.String())
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

type patchTemplateReq struct {
	Type domain.DocumentType `json:"type,omitempty"`
	Name string              `json:"name,omitempty"`
	Body map[string]any      `json:"body,omitempty"`
}

func patchTemplate(svc *service.Service) http.HandlerFunc {
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
		var req patchTemplateReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		// Fetch existing so empty (omitted) fields fall back to current values.
		existing, err := svc.Templates.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		in := service.UpdateTemplateInput{
			TenantID: tid,
			ID:       id,
			Type:     existing.Type,
			Name:     existing.Name,
			Body:     req.Body, // nil → service keeps existing body
		}
		if req.Type != "" {
			in.Type = req.Type
		}
		if req.Name != "" {
			in.Name = req.Name
		}
		t, err := svc.UpdateTemplate(r.Context(), in)
		if err != nil {
			switch {
			case errors.Is(err, domain.ErrNotFound):
				writeErr(w, 404, err)
			case errors.Is(err, domain.ErrForbidden):
				writeErr(w, 403, errors.New("system templates are read-only"))
			case errors.Is(err, domain.ErrInvalidInput):
				writeErr(w, 400, err)
			default:
				writeErr(w, 500, err)
			}
			return
		}
		auditWrite(svc, r, tid, "document.template.update", "document_template", t.ID.String())
		writeJSON(w, 200, t)
	}
}

func deleteTemplate(svc *service.Service) http.HandlerFunc {
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
		if err := svc.DeleteTemplate(r.Context(), tid, id); err != nil {
			switch {
			case errors.Is(err, domain.ErrNotFound):
				writeErr(w, 404, err)
			case errors.Is(err, domain.ErrForbidden):
				writeErr(w, 403, errors.New("system templates cannot be deleted"))
			default:
				writeErr(w, 500, err)
			}
			return
		}
		auditWrite(svc, r, tid, "document.template.delete", "document_template", id.String())
		w.WriteHeader(204)
	}
}

// --- Tier-1 e-signature handlers ---

type signerReq struct {
	ID         string `json:"id"`
	SignerID   string `json:"signer_id"`
	Name       string `json:"name,omitempty"`
	Email      string `json:"email,omitempty"`
	AuthMethod string `json:"auth_method,omitempty"`
}

type createEnvelopeReq struct {
	Title        string      `json:"title,omitempty"`
	SigningOrder string      `json:"signing_order,omitempty"`
	ExpiresAt    *time.Time  `json:"expires_at,omitempty"`
	Signers      []signerReq `json:"signers"`
}

func createEnvelope(svc *service.Service) http.HandlerFunc {
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
		var req createEnvelopeReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		var signers []store.NewSignerInput
		for _, s := range req.Signers {
			raw := s.SignerID
			if raw == "" {
				raw = s.ID
			}
			sid, err := uuid.Parse(raw)
			if err != nil {
				writeErr(w, 400, errors.New("each signer requires a valid signer_id (uuid)"))
				return
			}
			signers = append(signers, store.NewSignerInput{
				SignerID:   sid,
				Name:       s.Name,
				Email:      s.Email,
				AuthMethod: domain.AuthMethod(s.AuthMethod),
			})
		}
		env, err := svc.CreateEnvelope(r.Context(), service.CreateEnvelopeInput{
			TenantID:     tid,
			DocumentID:   docID,
			Title:        req.Title,
			SigningOrder: domain.SigningOrder(req.SigningOrder),
			CreatedBy:    auditMeta(r).ActorID,
			ExpiresAt:    req.ExpiresAt,
			Signers:      signers,
		})
		if err != nil {
			writeSignErr(w, err)
			return
		}
		// Platform audit_log row for cross-service visibility; the signing
		// subsystem's own hash-chained sign_event trail is recorded separately
		// inside svc.CreateEnvelope and is not affected by this call.
		auditWriteMeta(svc, r, tid, "document.sign.envelope.create", "sign_envelope", env.ID.String(),
			map[string]any{"document_id": docID.String()})
		writeJSON(w, 201, env)
	}
}

func listEnvelopesForDoc(svc *service.Service) http.HandlerFunc {
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
		items, err := svc.Signatures.ListEnvelopesForDocument(r.Context(), tid, docID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		if items == nil {
			items = []domain.SignEnvelope{}
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
	}
}

func getEnvelope(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		envID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		env, err := svc.Signatures.GetEnvelope(r.Context(), tid, envID)
		if err != nil {
			writeSignErr(w, err)
			return
		}
		writeJSON(w, 200, env)
	}
}

func sendEnvelope(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		envID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		env, err := svc.SendEnvelope(r.Context(), tid, envID, auditMeta(r))
		if err != nil {
			writeSignErr(w, err)
			return
		}
		writeJSON(w, 200, env)
	}
}

func viewSigner(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		envID, signerID, ok := envSignerIDs(w, r)
		if !ok {
			return
		}
		sg, err := svc.ViewEnvelopeSigner(r.Context(), tid, envID, signerID, auditMeta(r))
		if err != nil {
			writeSignErr(w, err)
			return
		}
		writeJSON(w, 200, sg)
	}
}

type signSignerReq struct {
	Consent           bool   `json:"consent"`
	TypedName         string `json:"typed_name,omitempty"`
	SignatureImageB64 string `json:"signature_image_b64,omitempty"`
	AuthMethod        string `json:"auth_method,omitempty"`
	// OTPCode is required when the signer row's auth_method is email_otp.
	OTPCode string `json:"otp_code,omitempty"`
}

func signEnvelopeSigner(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		envID, signerID, ok := envSignerIDs(w, r)
		if !ok {
			return
		}
		var req signSignerReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if !req.Consent {
			writeErr(w, 400, errors.New("consent:true is required (ESIGN consent-to-electronic-records)"))
			return
		}
		var img []byte
		if req.SignatureImageB64 != "" {
			b, err := base64.StdEncoding.DecodeString(stripDataURL(req.SignatureImageB64))
			if err != nil {
				writeErr(w, 400, errors.New("signature_image_b64 must be valid base64"))
				return
			}
			img = b
		}
		res, err := svc.SignEnvelopeSigner(r.Context(), service.SignInput{
			TenantID:    tid,
			EnvelopeID:  envID,
			SignerRowID: signerID,
			Consent:     req.Consent,
			TypedName:   req.TypedName,
			ImageBytes:  img,
			AuthMethod:  domain.AuthMethod(req.AuthMethod),
			OTPCode:     req.OTPCode,
		}, auditMeta(r))
		if err != nil {
			writeSignErr(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{
			"signer":    res.Signer,
			"envelope":  res.Envelope,
			"completed": res.Completed,
		})
	}
}

func declineEnvelopeSigner(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		envID, signerID, ok := envSignerIDs(w, r)
		if !ok {
			return
		}
		var req declineReq
		_ = json.NewDecoder(r.Body).Decode(&req)
		sg, env, err := svc.DeclineEnvelopeSigner(r.Context(), tid, envID, signerID, req.Reason, auditMeta(r))
		if err != nil {
			writeSignErr(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"signer": sg, "envelope": env})
	}
}

func voidEnvelope(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		envID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req declineReq
		_ = json.NewDecoder(r.Body).Decode(&req)
		env, err := svc.VoidEnvelope(r.Context(), tid, envID, req.Reason, auditMeta(r))
		if err != nil {
			writeSignErr(w, err)
			return
		}
		writeJSON(w, 200, env)
	}
}

func verifyEnvelope(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		envID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		res, err := svc.VerifyChain(r.Context(), tid, envID)
		if err != nil {
			writeSignErr(w, err)
			return
		}
		writeJSON(w, 200, res)
	}
}

func envelopeAudit(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		envID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		events, err := svc.Signatures.ListEvents(r.Context(), tid, envID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		if events == nil {
			events = []domain.SignEvent{}
		}
		writeJSON(w, 200, map[string]any{"items": events, "total": len(events)})
	}
}

func envelopeCertificate(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		envID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		pdf, err := svc.GetCertificate(r.Context(), tid, envID)
		if err != nil {
			writeSignErr(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", `inline; filename="certificate-of-completion.pdf"`)
		w.WriteHeader(200)
		_, _ = w.Write(pdf)
	}
}

// docSignAudit aggregates audit events across all envelopes for a document.
func docSignAudit(svc *service.Service) http.HandlerFunc {
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
		envs, err := svc.Signatures.ListEnvelopesForDocument(r.Context(), tid, docID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		all := []domain.SignEvent{}
		for _, e := range envs {
			evs, err := svc.Signatures.ListEvents(r.Context(), tid, e.ID)
			if err != nil {
				writeErr(w, 500, err)
				return
			}
			all = append(all, evs...)
		}
		writeJSON(w, 200, map[string]any{"items": all, "total": len(all)})
	}
}

// docSignCertificate returns the certificate of the most recent completed
// envelope for a document.
func docSignCertificate(svc *service.Service) http.HandlerFunc {
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
		envs, err := svc.Signatures.ListEnvelopesForDocument(r.Context(), tid, docID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		for _, e := range envs { // newest first
			if e.Status == domain.EnvCompleted {
				pdf, err := svc.GetCertificate(r.Context(), tid, e.ID)
				if err != nil {
					writeSignErr(w, err)
					return
				}
				w.Header().Set("Content-Type", "application/pdf")
				w.Header().Set("Content-Disposition", `inline; filename="certificate-of-completion.pdf"`)
				w.WriteHeader(200)
				_, _ = w.Write(pdf)
				return
			}
		}
		writeErr(w, 404, domain.ErrNotFound)
	}
}

type declineReq struct {
	Reason string `json:"reason"`
}

func envSignerIDs(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	envID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writeErr(w, 400, err)
		return uuid.Nil, uuid.Nil, false
	}
	signerID, err := uuid.Parse(chi.URLParam(r, "signerId"))
	if err != nil {
		writeErr(w, 400, err)
		return uuid.Nil, uuid.Nil, false
	}
	return envID, signerID, true
}

func stripDataURL(s string) string {
	if i := indexByte(s, ','); i >= 0 && len(s) > 5 && s[:5] == "data:" {
		return s[i+1:]
	}
	return s
}

func writeSignErr(w http.ResponseWriter, err error) {
	if isOTPErr(err) { // OTP step-up taxonomy: 428 / 403 / 429 (handlers_otp.go)
		writeOTPErr(w, err)
		return
	}
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeErr(w, 404, err)
	case errors.Is(err, domain.ErrInvalidInput):
		writeErr(w, 400, err)
	case errors.Is(err, domain.ErrConflict):
		writeErr(w, 409, err)
	case errors.Is(err, domain.ErrForbidden):
		writeErr(w, 403, err)
	default:
		writeErr(w, 500, err)
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
