package api

import (
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

	"github.com/pmplatform/services/project-svc/internal/domain"
	"github.com/pmplatform/services/project-svc/internal/service"
	"github.com/pmplatform/services/project-svc/internal/store"
)

// initURLParam wires libauth.URLParam to chi.URLParam exactly once so the
// scoped authz middleware can resolve `{:id}` placeholders.
var initURLParam = sync.OnceFunc(func() {
	libauth.URLParam = chi.URLParam
})

// NewRouter wires the project-svc HTTP surface.
//
// authz is the Cedar-backed authorizer used to gate write endpoints. When
// nil the RequireAction middleware becomes a no-op (libs/go/auth contract),
// which is how the legacy unit tests keep working without minting JWTs. The
// dedicated cedar_*_test.go cases pass a real *libpolicy.Adapter to exercise
// the allow/deny grid against the shared bundle.
//
// Per-instance ABAC scoping (Plan #6 Task 6 Step 3): every write route with
// an id in the path now uses RequireActionScoped against the matching
// Cedar entity (`Project::{:id}`, `Task::{:id}`, `Sprint::{:id}`), and the
// resource loader supplies tenant_id / owner_user from the project-svc
// store. Create endpoints (no id at request time) keep RequireAction with
// resource `*` and rely on the role-based permit + RLS for cross-tenant
// protection.
func NewRouter(svc *service.Service, authz libauth.Authorizer) http.Handler {
	return NewRouterWithLoader(svc, authz, nil)
}

// NewRouterWithLoader wires project-svc with an optional Cedar resource
// loader. main.go wires NewCedarLoader; tests can pass nil to keep the
// scoped middleware at the literal-template level.
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
		// Projects
		r.Get("/projects", listProjects(svc))
		// no resource id at create time — ABAC for create gates by context.tenant_id only
		r.With(libauth.RequireAction(authz, "project.create", "*")).Post("/projects", createProject(svc))
		r.Get("/projects/{id}", getProject(svc))
		r.With(libauth.RequireActionScoped(authz, "project.update", "Project::{:id}", loaderOpts...)).Patch("/projects/{id}", updateProject(svc))
		r.With(libauth.RequireActionScoped(authz, "project.delete", "Project::{:id}", loaderOpts...)).Delete("/projects/{id}", deleteProject(svc))

		// Tasks under project — resource is the parent project so the
		// loader returns the project's tenant_id (the new task will inherit it).
		r.Get("/projects/{id}/tasks", listTasks(svc))
		r.With(libauth.RequireActionScoped(authz, "project.task.create", "Project::{:id}", loaderOpts...)).Post("/projects/{id}/tasks", createTask(svc))

		// Tasks standalone
		r.Get("/tasks", listAllTasks(svc))
		r.Get("/tasks/{id}", getTask(svc))
		r.With(libauth.RequireActionScoped(authz, "project.task.update", "Task::{:id}", loaderOpts...)).Patch("/tasks/{id}", updateTask(svc))
		r.With(libauth.RequireActionScoped(authz, "project.task.delete", "Task::{:id}", loaderOpts...)).Delete("/tasks/{id}", deleteTask(svc))
		r.With(libauth.RequireActionScoped(authz, "project.task.add_dependency", "Task::{:id}", loaderOpts...)).Post("/tasks/{id}/dependencies", addDependency(svc))

		// Dependencies — the row is keyed on the dependency id, which the
		// loader doesn't model; keep RequireAction with "*" until a
		// TaskDependency entity is added.
		// no resource id at create time — ABAC for create gates by context.tenant_id only
		r.With(libauth.RequireAction(authz, "project.task.remove_dependency", "*")).Delete("/dependencies/{id}", removeDependency(svc))

		// Sprints
		r.Get("/projects/{id}/sprints", listSprints(svc))
		r.With(libauth.RequireActionScoped(authz, "project.sprint.create", "Project::{:id}", loaderOpts...)).Post("/projects/{id}/sprints", createSprint(svc))
		r.Get("/sprints/{id}", getSprint(svc))
		r.With(libauth.RequireActionScoped(authz, "project.sprint.update", "Sprint::{:id}", loaderOpts...)).Patch("/sprints/{id}", updateSprint(svc))
		r.Get("/sprints/{id}/tasks", listSprintTasks(svc))
		r.With(libauth.RequireActionScoped(authz, "project.sprint.assign_task", "Sprint::{:id}", loaderOpts...)).Post("/sprints/{id}/tasks/{taskId}", assignTask(svc))
		r.With(libauth.RequireActionScoped(authz, "project.sprint.unassign_task", "Sprint::{:id}", loaderOpts...)).Delete("/sprints/{id}/tasks/{taskId}", unassignTask(svc))
	})

	return r
}

// tenantOr400 parses the X-Tenant-Id header and returns the tenant UUID or writes 400.
func tenantOr400(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	raw := r.Header.Get("X-Tenant-Id")
	tid, err := uuid.Parse(raw)
	if err != nil {
		writeErr(w, 400, errors.New("X-Tenant-Id required"))
		return uuid.Nil, false
	}
	return tid, true
}

type optionalUUID struct {
	Set   bool
	Value *uuid.UUID
}

func (o *optionalUUID) UnmarshalJSON(data []byte) error {
	o.Set = true
	if string(data) == "null" {
		o.Value = nil
		return nil
	}
	var v uuid.UUID
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	o.Value = &v
	return nil
}

type optionalDate struct {
	Set   bool
	Value *time.Time
}

func (o *optionalDate) UnmarshalJSON(data []byte) error {
	o.Set = true
	if string(data) == "null" {
		o.Value = nil
		return nil
	}
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if raw == "" {
		o.Value = nil
		return nil
	}
	t, err := parseDate(raw)
	if err != nil {
		return err
	}
	o.Value = &t
	return nil
}

func parseDate(v string) (time.Time, error) {
	if t, err := time.Parse("2006-01-02", v); err == nil {
		return t, nil
	}
	return time.Parse(time.RFC3339, v)
}

// --- Projects ---

type createProjectReq struct {
	Code        string               `json:"code"`
	Name        string               `json:"name"`
	Description string               `json:"description,omitempty"`
	Status      domain.ProjectStatus `json:"status,omitempty"`
	OwnerID     *uuid.UUID           `json:"owner_id,omitempty"`
}

func createProject(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		var req createProjectReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		var actorID string
		if c, ok := libauth.FromCtx(r.Context()); ok {
			actorID = c.Subject
		}
		p, err := svc.CreateProject(r.Context(), service.CreateProjectInput{
			TenantID:    tid,
			Code:        req.Code,
			Name:        req.Name,
			Description: req.Description,
			Status:      req.Status,
			OwnerID:     req.OwnerID,
			ActorID:     actorID,
		})
		if err != nil {
			switch {
			case errors.Is(err, domain.ErrInvalidCode), errors.Is(err, domain.ErrInvalidInput):
				writeErr(w, 400, err)
			default:
				writeErr(w, 500, err)
			}
			return
		}
		writeJSON(w, 201, p)
	}
}

func getProject(svc *service.Service) http.HandlerFunc {
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
		p, err := svc.Projects.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, p)
	}
}

func listProjects(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		q := r.URL.Query().Get("q")
		status := r.URL.Query().Get("status")
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

		items, total, err := svc.Projects.List(r.Context(), tid, store.ListProjectsOpts{
			Q: q, Status: status, Limit: limit, Offset: offset,
		})
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateProjectReq struct {
	Name        string               `json:"name,omitempty"`
	Description string               `json:"description,omitempty"`
	Status      domain.ProjectStatus `json:"status,omitempty"`
	OwnerID     optionalUUID         `json:"owner_id"`
	StartDate   optionalDate         `json:"start_date"`
	DueDate     optionalDate         `json:"due_date"`
	ProgressPct *int                 `json:"progress_pct,omitempty"`
	Tags        []string             `json:"tags,omitempty"`
	Version     int                  `json:"version"`
}

func updateProject(svc *service.Service) http.HandlerFunc {
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
		var req updateProjectReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		// Resolve caller identity for notification routing (best-effort).
		var callerID string
		if c, ok := libauth.FromCtx(r.Context()); ok {
			callerID = c.Subject
		}
		p, err := svc.UpdateProject(r.Context(), service.UpdateProjectInput{
			TenantID:     tid,
			ID:           id,
			Name:         req.Name,
			Description:  req.Description,
			Status:       req.Status,
			OwnerID:      req.OwnerID.Value,
			OwnerIDSet:   req.OwnerID.Set,
			StartDate:    req.StartDate.Value,
			StartDateSet: req.StartDate.Set,
			DueDate:      req.DueDate.Value,
			DueDateSet:   req.DueDate.Set,
			ProgressPct:  req.ProgressPct,
			Tags:         req.Tags,
			Version:      req.Version,
			UserID:       callerID,
		})
		if err != nil {
			switch {
			case errors.Is(err, domain.ErrInvalidInput):
				writeErr(w, 400, err)
			case errors.Is(err, domain.ErrNotFound):
				writeErr(w, 404, err)
			case errors.Is(err, domain.ErrConflict):
				writeErr(w, 409, err)
			default:
				writeErr(w, 500, err)
			}
			return
		}
		writeJSON(w, 200, p)
	}
}

func deleteProject(svc *service.Service) http.HandlerFunc {
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
		if err := svc.Projects.SoftDelete(r.Context(), tid, id, version); err != nil {
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

// --- Tasks ---

type createTaskReq struct {
	Code        string              `json:"code"`
	Title       string              `json:"title"`
	Description string              `json:"description,omitempty"`
	ParentID    *uuid.UUID          `json:"parent_id,omitempty"`
	Type        domain.TaskType     `json:"type,omitempty"`
	Status      domain.TaskStatus   `json:"status,omitempty"`
	Priority    domain.TaskPriority `json:"priority,omitempty"`
	AssigneeID  *uuid.UUID          `json:"assignee_id,omitempty"`
	ReviewerID  *uuid.UUID          `json:"reviewer_id,omitempty"`
	EstimateMd  float64             `json:"estimate_md,omitempty"`
	StartDate   *string             `json:"start_date,omitempty"`
	DueDate     *string             `json:"due_date,omitempty"`
	Tags        []string            `json:"tags,omitempty"`
}

func createTask(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		projectID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req createTaskReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		var startDate *time.Time
		if req.StartDate != nil && *req.StartDate != "" {
			parsed, err := parseDate(*req.StartDate)
			if err != nil {
				writeErr(w, 400, errors.New("invalid start_date"))
				return
			}
			startDate = &parsed
		}
		var dueDate *time.Time
		if req.DueDate != nil && *req.DueDate != "" {
			parsed, err := parseDate(*req.DueDate)
			if err != nil {
				writeErr(w, 400, errors.New("invalid due_date"))
				return
			}
			dueDate = &parsed
		}
		t, err := svc.CreateTask(r.Context(), service.CreateTaskInput{
			TenantID:    tid,
			ProjectID:   projectID,
			ParentID:    req.ParentID,
			Code:        req.Code,
			Title:       req.Title,
			Description: req.Description,
			Type:        req.Type,
			Status:      req.Status,
			Priority:    req.Priority,
			AssigneeID:  req.AssigneeID,
			ReviewerID:  req.ReviewerID,
			EstimateMd:  req.EstimateMd,
			StartDate:   startDate,
			DueDate:     dueDate,
			Tags:        req.Tags,
		})
		if err != nil {
			switch {
			case errors.Is(err, domain.ErrInvalidCode), errors.Is(err, domain.ErrInvalidInput):
				writeErr(w, 400, err)
			default:
				writeErr(w, 500, err)
			}
			return
		}
		writeJSON(w, 201, t)
	}
}

func getTask(svc *service.Service) http.HandlerFunc {
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
		t, err := svc.Tasks.GetByID(r.Context(), tid, id)
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

func listAllTasks(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		q := r.URL.Query().Get("q")
		status := r.URL.Query().Get("status")
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

		opts := store.ListTasksOpts{
			ProjectID: nil,
			Q:         q,
			Status:    status,
			Limit:     limit,
			Offset:    offset,
		}
		if assigneeStr := r.URL.Query().Get("assignee"); assigneeStr != "" {
			if aid, err := uuid.Parse(assigneeStr); err == nil {
				opts.Assignee = &aid
			}
		}

		items, total, err := svc.Tasks.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

func listTasks(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		projectID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		q := r.URL.Query().Get("q")
		status := r.URL.Query().Get("status")
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))

		opts := store.ListTasksOpts{
			ProjectID: &projectID,
			Q:         q,
			Status:    status,
			Limit:     limit,
			Offset:    offset,
		}
		if assigneeStr := r.URL.Query().Get("assignee"); assigneeStr != "" {
			if aid, err := uuid.Parse(assigneeStr); err == nil {
				opts.Assignee = &aid
			}
		}

		items, total, err := svc.Tasks.List(r.Context(), tid, opts)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": total})
	}
}

type updateTaskReq struct {
	Title       string              `json:"title,omitempty"`
	Description string              `json:"description,omitempty"`
	Type        domain.TaskType     `json:"type,omitempty"`
	Status      domain.TaskStatus   `json:"status,omitempty"`
	Priority    domain.TaskPriority `json:"priority,omitempty"`
	AssigneeID  optionalUUID        `json:"assignee_id"`
	ReviewerID  optionalUUID        `json:"reviewer_id"`
	StartDate   optionalDate        `json:"start_date"`
	DueDate     optionalDate        `json:"due_date"`
	EstimateMd  *float64            `json:"estimate_md,omitempty"`
	ActualMd    *float64            `json:"actual_md,omitempty"`
	ProgressPct *int                `json:"progress_pct,omitempty"`
	SortOrder   *int                `json:"sort_order,omitempty"`
	Tags        []string            `json:"tags,omitempty"`
	ParentID    optionalUUID        `json:"parent_id"`
	Version     int                 `json:"version"`
}

func updateTask(svc *service.Service) http.HandlerFunc {
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
		var req updateTaskReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Version <= 0 {
			writeErr(w, 400, errors.New("version is required"))
			return
		}
		if req.Type != "" && !domain.IsValidTaskType(req.Type) {
			writeErr(w, 400, domain.ErrInvalidInput)
			return
		}
		if req.Status != "" && !domain.IsValidTaskStatus(req.Status) {
			writeErr(w, 400, domain.ErrInvalidInput)
			return
		}
		if req.Priority != "" && !domain.IsValidTaskPriority(req.Priority) {
			writeErr(w, 400, domain.ErrInvalidInput)
			return
		}
		t, err := svc.Tasks.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		if req.Title != "" {
			t.Title = req.Title
		}
		if req.Description != "" {
			t.Description = req.Description
		}
		if req.Type != "" {
			t.Type = req.Type
		}
		if req.Status != "" {
			t.Status = req.Status
		}
		if req.Priority != "" {
			t.Priority = req.Priority
		}
		if req.AssigneeID.Set {
			t.AssigneeID = req.AssigneeID.Value
		}
		if req.ReviewerID.Set {
			t.ReviewerID = req.ReviewerID.Value
		}
		if req.StartDate.Set {
			t.StartDate = req.StartDate.Value
		}
		if req.DueDate.Set {
			t.DueDate = req.DueDate.Value
		}
		if req.EstimateMd != nil {
			t.EstimateMd = *req.EstimateMd
		}
		if req.ActualMd != nil {
			t.ActualMd = *req.ActualMd
		}
		if req.ProgressPct != nil {
			t.ProgressPct = *req.ProgressPct
		}
		if req.SortOrder != nil {
			t.SortOrder = *req.SortOrder
		}
		if req.Tags != nil {
			t.Tags = req.Tags
		}
		if req.ParentID.Set {
			t.ParentID = req.ParentID.Value
		}
		if t.ParentID != nil && *t.ParentID == t.ID {
			writeErr(w, 400, domain.ErrInvalidInput)
			return
		}
		if err := domain.ValidateTaskPlan(t.EstimateMd, t.ActualMd, t.ProgressPct, t.StartDate, t.DueDate); err != nil {
			writeErr(w, 400, err)
			return
		}
		t.Version = req.Version
		if err := svc.Tasks.Update(r.Context(), t); err != nil {
			switch {
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

func deleteTask(svc *service.Service) http.HandlerFunc {
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
		if err := svc.Tasks.SoftDelete(r.Context(), tid, id, version); err != nil {
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

type addDepReq struct {
	PredecessorID uuid.UUID      `json:"predecessor_id"`
	Type          domain.DepType `json:"type,omitempty"`
	LagDays       int            `json:"lag_days,omitempty"`
}

func addDependency(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		successorID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req addDepReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Type == "" {
			req.Type = domain.DepFS
		}
		dep := &domain.TaskDependency{
			ID:            uuid.New(),
			TenantID:      tid,
			PredecessorID: req.PredecessorID,
			SuccessorID:   successorID,
			Type:          req.Type,
			LagDays:       req.LagDays,
		}
		if err := svc.Tasks.AddDependency(r.Context(), tid, dep); err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, dep)
	}
}

func removeDependency(svc *service.Service) http.HandlerFunc {
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
		if err := svc.Tasks.RemoveDependency(r.Context(), tid, id); err != nil {
			writeErr(w, 500, err)
			return
		}
		w.WriteHeader(204)
	}
}

// --- Sprints ---

type createSprintReq struct {
	Name        string              `json:"name"`
	Goal        string              `json:"goal,omitempty"`
	Status      domain.SprintStatus `json:"status,omitempty"`
	StartDate   *string             `json:"start_date,omitempty"`
	EndDate     *string             `json:"end_date,omitempty"`
	CapacityPts int                 `json:"capacity_pts,omitempty"`
}

func createSprint(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		projectID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req createSprintReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		var startDate *time.Time
		if req.StartDate != nil && *req.StartDate != "" {
			parsed, err := parseDate(*req.StartDate)
			if err != nil {
				writeErr(w, 400, errors.New("invalid start_date"))
				return
			}
			startDate = &parsed
		}
		var endDate *time.Time
		if req.EndDate != nil && *req.EndDate != "" {
			parsed, err := parseDate(*req.EndDate)
			if err != nil {
				writeErr(w, 400, errors.New("invalid end_date"))
				return
			}
			endDate = &parsed
		}
		sp, err := svc.CreateSprint(r.Context(), service.CreateSprintInput{
			TenantID:    tid,
			ProjectID:   projectID,
			Name:        req.Name,
			Goal:        req.Goal,
			Status:      req.Status,
			StartDate:   startDate,
			EndDate:     endDate,
			CapacityPts: req.CapacityPts,
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
		writeJSON(w, 201, sp)
	}
}

func getSprint(svc *service.Service) http.HandlerFunc {
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
		sp, err := svc.Sprints.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, sp)
	}
}

func listSprintTasks(svc *service.Service) http.HandlerFunc {
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
		tasks, err := svc.Sprints.Tasks(r.Context(), tid, id)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": tasks, "total": len(tasks)})
	}
}

func listSprints(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		projectID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		items, err := svc.Sprints.List(r.Context(), tid, projectID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"items": items, "total": len(items)})
	}
}

type updateSprintReq struct {
	Name        string              `json:"name,omitempty"`
	Goal        string              `json:"goal,omitempty"`
	Status      domain.SprintStatus `json:"status,omitempty"`
	StartDate   optionalDate        `json:"start_date"`
	EndDate     optionalDate        `json:"end_date"`
	CapacityPts *int                `json:"capacity_pts,omitempty"`
	Version     int                 `json:"version"`
}

func updateSprint(svc *service.Service) http.HandlerFunc {
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
		var req updateSprintReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Version <= 0 {
			writeErr(w, 400, errors.New("version is required"))
			return
		}
		if req.Status != "" && !domain.IsValidSprintStatus(req.Status) {
			writeErr(w, 400, domain.ErrInvalidInput)
			return
		}
		sp, err := svc.Sprints.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		if req.Name != "" {
			sp.Name = req.Name
		}
		if req.Goal != "" {
			sp.Goal = req.Goal
		}
		if req.Status != "" {
			sp.Status = req.Status
		}
		if req.StartDate.Set {
			sp.StartDate = req.StartDate.Value
		}
		if req.EndDate.Set {
			sp.EndDate = req.EndDate.Value
		}
		if req.CapacityPts != nil {
			sp.CapacityPts = *req.CapacityPts
		}
		if err := domain.ValidateSprintPlan(sp.CapacityPts, sp.StartDate, sp.EndDate); err != nil {
			writeErr(w, 400, err)
			return
		}
		sp.Version = req.Version
		if err := svc.Sprints.Update(r.Context(), sp); err != nil {
			switch {
			case errors.Is(err, domain.ErrConflict):
				writeErr(w, 409, err)
			default:
				writeErr(w, 500, err)
			}
			return
		}
		writeJSON(w, 200, sp)
	}
}

func assignTask(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		sprintID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		taskID, err := uuid.Parse(chi.URLParam(r, "taskId"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		if err := svc.Sprints.AssignTask(r.Context(), tid, sprintID, taskID); err != nil {
			writeErr(w, 500, err)
			return
		}
		w.WriteHeader(204)
	}
}

func unassignTask(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		sprintID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		taskID, err := uuid.Parse(chi.URLParam(r, "taskId"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		if err := svc.Sprints.UnassignTask(r.Context(), tid, sprintID, taskID); err != nil {
			writeErr(w, 500, err)
			return
		}
		w.WriteHeader(204)
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
