package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	libauth "github.com/pmplatform/libs/go/auth"

	"github.com/pmplatform/services/workflow-svc/internal/domain"
	"github.com/pmplatform/services/workflow-svc/internal/service"
	"github.com/pmplatform/services/workflow-svc/internal/store"
)

// NewRouter wires the workflow-svc HTTP surface.
//
// authz is the Cedar-backed authorizer used to gate write endpoints. When
// nil the RequireAction middleware becomes a no-op (libs/go/auth contract),
// which is how the legacy unit tests keep working without minting JWTs. The
// dedicated cedar_*_test.go cases pass a real *libpolicy.Adapter to exercise
// the allow/deny grid against the shared bundle.
//
// Resource strings use the wildcard "*" for now; per-instance resources
// (Workflow::"<id>", Instance::"<id>", HumanTask::"<id>", etc. derived from
// chi.URLParam) are a Plan #4 polish pass / Plan #6 ABAC follow-up — the ADR
// rows document the target shape.
func NewRouter(svc *service.Service, authz libauth.Authorizer) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})

	r.Route("/v1", func(r chi.Router) {
		// Definitions
		r.Get("/workflows", listWorkflows(svc))
		r.With(libauth.RequireAction(authz, "workflow.create", "*")).Post("/workflows", createWorkflow(svc))
		r.Get("/workflows/{id}", getWorkflow(svc))
		r.With(libauth.RequireAction(authz, "workflow.update", "*")).Patch("/workflows/{id}", updateWorkflow(svc))
		r.With(libauth.RequireAction(authz, "workflow.delete", "*")).Delete("/workflows/{id}", deleteWorkflow(svc))

		// Versions
		r.Get("/workflows/{id}/versions", listVersions(svc))
		r.With(libauth.RequireAction(authz, "workflow.version.create", "*")).Post("/workflows/{id}/versions", createVersion(svc))
		r.Get("/workflow-versions/{id}", getVersion(svc))
		r.With(libauth.RequireAction(authz, "workflow.publish", "*")).Post("/workflows/{id}/publish", publishWorkflow(svc))

		// Instances
		r.Get("/workflows/{id}/instances", listInstances(svc))
		r.With(libauth.RequireAction(authz, "workflow.instance.start", "*")).Post("/workflows/{id}/start", startInstance(svc))
		r.Get("/instances/{id}", getInstance(svc))
		r.With(libauth.RequireAction(authz, "workflow.instance.resume", "*")).Post("/instances/{id}/resume", resumeInstance(svc))
		r.With(libauth.RequireAction(authz, "workflow.instance.cancel", "*")).Post("/instances/{id}/cancel", cancelInstance(svc))

		// Human tasks
		r.Get("/human-tasks", listHumanTasks(svc))
		r.Get("/instances/{id}/human-tasks", listInstanceHumanTasks(svc))
		r.With(libauth.RequireAction(authz, "workflow.human_task.complete", "*")).Post("/human-tasks/{id}/complete", completeHumanTask(svc))
	})

	return r
}

// ─── Helper ───────────────────────────────────────────────────────────────────

func tenantOr400(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	raw := r.Header.Get("X-Tenant-Id")
	tid, err := uuid.Parse(raw)
	if err != nil {
		writeErr(w, 400, errors.New("X-Tenant-Id required"))
		return uuid.Nil, false
	}
	return tid, true
}

func writeJSON(w http.ResponseWriter, code int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

// ─── Definitions ──────────────────────────────────────────────────────────────

type createWorkflowReq struct {
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Trigger     json.RawMessage `json:"trigger,omitempty"`
}

func createWorkflow(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createWorkflowReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Name == "" {
			writeErr(w, 400, errors.New("name required"))
			return
		}
		trigger := req.Trigger
		if trigger == nil {
			trigger = json.RawMessage(`{"type":"manual"}`)
		}
		d := &domain.WorkflowDefinition{
			ID:             uuid.New(),
			TenantID:       tid,
			Name:           req.Name,
			Description:    req.Description,
			Trigger:        trigger,
			Status:         domain.WorkflowDraft,
			CurrentVersion: 1,
			Version:        1,
		}
		if err := svc.Defs.Create(r.Context(), d); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, d)
	}
}

func getWorkflow(svc *service.Service) http.HandlerFunc {
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
		d, err := svc.Defs.GetByID(r.Context(), tid, id)
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

func listWorkflows(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		q := r.URL.Query().Get("q")
		status := r.URL.Query().Get("status")
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

		items, total, err := svc.Defs.List(r.Context(), tid, store.ListDefsOpts{
			Q: q, Status: status, Limit: limit, Offset: offset,
		})
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateWorkflowReq struct {
	Name        string          `json:"name,omitempty"`
	Description string          `json:"description,omitempty"`
	Trigger     json.RawMessage `json:"trigger,omitempty"`
	Status      string          `json:"status,omitempty"`
	Version     int             `json:"version"`
}

func updateWorkflow(svc *service.Service) http.HandlerFunc {
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
		var req updateWorkflowReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		d, err := svc.Defs.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		if req.Name != "" {
			d.Name = req.Name
		}
		if req.Description != "" {
			d.Description = req.Description
		}
		if req.Trigger != nil {
			d.Trigger = req.Trigger
		}
		if req.Status != "" {
			d.Status = domain.WorkflowStatus(req.Status)
		}
		d.Version = req.Version
		if err := svc.Defs.Update(r.Context(), d); err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, d)
	}
}

func deleteWorkflow(svc *service.Service) http.HandlerFunc {
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
		if err := svc.Defs.SoftDelete(r.Context(), tid, id, version); err != nil {
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

// ─── Versions ─────────────────────────────────────────────────────────────────

type createVersionReq struct {
	DSL   json.RawMessage `json:"dsl"`
	Notes string          `json:"notes,omitempty"`
}

func createVersion(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		defID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req createVersionReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.DSL == nil {
			writeErr(w, 400, errors.New("dsl required"))
			return
		}
		// Verify definition exists
		if _, err := svc.Defs.GetByID(r.Context(), tid, defID); err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}

		// Get existing versions to determine next rev
		existing, _ := svc.Versions.ListByDefinition(r.Context(), tid, defID)
		nextRev := 1
		for _, v := range existing {
			if v.Rev >= nextRev {
				nextRev = v.Rev + 1
			}
		}

		v := &domain.WorkflowVersion{
			ID:           uuid.New(),
			TenantID:     tid,
			DefinitionID: defID,
			Rev:          nextRev,
			DSL:          req.DSL,
			Notes:        req.Notes,
		}
		if err := svc.Versions.Create(r.Context(), v); err != nil {
			writeErr(w, 500, err)
			return
		}

		writeJSON(w, 201, v)
	}
}

func listVersions(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		defID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		items, err := svc.Versions.ListByDefinition(r.Context(), tid, defID)
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
		v, err := svc.Versions.GetByID(r.Context(), tid, id)
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

type publishReq struct {
	Rev     int `json:"rev"`
	Version int `json:"version"`
}

func publishWorkflow(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		defID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req publishReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Rev <= 0 {
			writeErr(w, 400, errors.New("rev required"))
			return
		}
		if err := svc.Defs.PublishVersion(r.Context(), tid, defID, req.Rev, req.Version); err != nil {
			if errors.Is(err, domain.ErrConflict) {
				writeErr(w, 409, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		d, _ := svc.Defs.GetByID(r.Context(), tid, defID)
		writeJSON(w, 200, d)
	}
}

// ─── Instances ────────────────────────────────────────────────────────────────

func listInstances(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		defID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		status := r.URL.Query().Get("status")
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

		items, total, err := svc.Instances.ListByDefinition(r.Context(), tid, defID, store.ListInstancesOpts{
			Status: status, Limit: limit, Offset: offset,
		})
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type startInstanceReq struct {
	Input json.RawMessage `json:"input,omitempty"`
}

func startInstance(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		defID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req startInstanceReq
		_ = json.NewDecoder(r.Body).Decode(&req)

		result, err := svc.StartInstance(r.Context(), service.StartInstanceInput{
			TenantID:     tid,
			DefinitionID: defID,
			Input:        req.Input,
		})
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, result)
	}
}

func getInstance(svc *service.Service) http.HandlerFunc {
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
		inst, err := svc.Instances.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		steps, _ := svc.Instances.ListSteps(r.Context(), tid, id)
		htList, _, _ := svc.HumanTasks.List(r.Context(), tid, store.ListHumanTasksOpts{
			InstanceID: &id, Limit: 200,
		})
		writeJSON(w, 200, map[string]any{
			"instance":    inst,
			"steps":       steps,
			"human_tasks": htList,
		})
	}
}

type resumeReq struct {
	Input json.RawMessage `json:"input,omitempty"`
}

func resumeInstance(svc *service.Service) http.HandlerFunc {
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
		var req resumeReq
		_ = json.NewDecoder(r.Body).Decode(&req)

		result, err := svc.ResumeInstance(r.Context(), service.ResumeInstanceInput{
			TenantID:   tid,
			InstanceID: id,
			Input:      req.Input,
		})
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, result)
	}
}

func cancelInstance(svc *service.Service) http.HandlerFunc {
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
		inst, err := svc.CancelInstance(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, inst)
	}
}

// ─── Human tasks ─────────────────────────────────────────────────────────────

func listHumanTasks(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		opts := store.ListHumanTasksOpts{
			Status: r.URL.Query().Get("status"),
		}
		if aidStr := r.URL.Query().Get("assignee_id"); aidStr != "" {
			if aid, err := uuid.Parse(aidStr); err == nil {
				opts.AssigneeID = &aid
			}
		}
		opts.Limit, _ = strconv.Atoi(r.URL.Query().Get("limit"))
		opts.Offset, _ = strconv.Atoi(r.URL.Query().Get("offset"))

		items, total, err := svc.HumanTasks.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		if items == nil {
			items = []*domain.HumanTask{}
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

func listInstanceHumanTasks(svc *service.Service) http.HandlerFunc {
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
		items, total, err := svc.HumanTasks.List(r.Context(), tid, store.ListHumanTasksOpts{
			InstanceID: &id, Limit: 200,
		})
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		if items == nil {
			items = []*domain.HumanTask{}
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type completeHTReq struct {
	Outcome string          `json:"outcome"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func completeHumanTask(svc *service.Service) http.HandlerFunc {
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
		var req completeHTReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Outcome == "" {
			writeErr(w, 400, errors.New("outcome required"))
			return
		}
		result, err := svc.CompleteHumanTask(r.Context(), tid, id, req.Outcome, req.Data)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, result)
	}
}
