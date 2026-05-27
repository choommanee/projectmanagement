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
		r.Get("/projects/{id}/task-dependencies", listProjectTaskDeps(svc))

		// Tasks standalone
		r.Get("/tasks", listAllTasks(svc))
		r.Get("/tasks/{id}", getTask(svc))
		r.With(libauth.RequireActionScoped(authz, "project.task.update", "Task::{:id}", loaderOpts...)).Patch("/tasks/{id}", updateTask(svc))
		r.With(libauth.RequireActionScoped(authz, "project.task.delete", "Task::{:id}", loaderOpts...)).Delete("/tasks/{id}", deleteTask(svc))
		r.With(libauth.RequireActionScoped(authz, "project.task.add_dependency", "Task::{:id}", loaderOpts...)).Post("/tasks/{id}/dependencies", addDependency(svc))

		// Worklogs
		r.Get("/tasks/{id}/worklogs", listWorklogs(svc))
		r.With(libauth.RequireActionScoped(authz, "project.task.update", "Task::{:id}", loaderOpts...)).
			Post("/tasks/{id}/worklogs", createWorklog(svc))

		// Task comments & activity feed
		r.Get("/tasks/{id}/comments", listTaskComments(svc))
		r.With(libauth.RequireActionScoped(authz, "project.task.update", "Task::{:id}", loaderOpts...)).
			Post("/tasks/{id}/comments", createTaskComment(svc))
		r.Get("/tasks/{id}/activity", listTaskActivity(svc))

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
		r.With(libauth.RequireActionScoped(authz, "project.sprint.delete", "Sprint::{:id}", loaderOpts...)).Delete("/sprints/{id}", deleteSprint(svc))
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
	OwnerID     *uuid.UUID           `json:"owner_id,omitempty"`
	ProgressPct *int                 `json:"progress_pct,omitempty"`
	Tags        []string             `json:"tags,omitempty"`
	StartDate   *string              `json:"start_date,omitempty"`
	DueDate     *string              `json:"due_date,omitempty"`
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
		// Parse optional date strings (YYYY-MM-DD or RFC3339).
		parseDatePtr := func(s *string) (*time.Time, error) {
			if s == nil || *s == "" {
				return nil, nil
			}
			if t, err := time.Parse("2006-01-02", *s); err == nil {
				return &t, nil
			}
			t, err := time.Parse(time.RFC3339, *s)
			if err != nil {
				return nil, err
			}
			return &t, nil
		}
		startDate, err := parseDatePtr(req.StartDate)
		if err != nil {
			writeErr(w, 400, errors.New("invalid start_date format, expected YYYY-MM-DD"))
			return
		}
		dueDate, err := parseDatePtr(req.DueDate)
		if err != nil {
			writeErr(w, 400, errors.New("invalid due_date format, expected YYYY-MM-DD"))
			return
		}
		p, err := svc.UpdateProject(r.Context(), service.UpdateProjectInput{
			TenantID:    tid,
			ID:          id,
			Name:        req.Name,
			Description: req.Description,
			Status:      req.Status,
			OwnerID:     req.OwnerID,
			ProgressPct: req.ProgressPct,
			Tags:        req.Tags,
			StartDate:   startDate,
			DueDate:     dueDate,
			Version:     req.Version,
			UserID:      callerID,
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
	Code        string               `json:"code"`
	Title       string               `json:"title"`
	Description string               `json:"description,omitempty"`
	ParentID    *uuid.UUID           `json:"parent_id,omitempty"`
	Type        domain.TaskType      `json:"type,omitempty"`
	Priority    domain.TaskPriority  `json:"priority,omitempty"`
	AssigneeID  *uuid.UUID           `json:"assignee_id,omitempty"`
	ReviewerID  *uuid.UUID           `json:"reviewer_id,omitempty"`
	EstimateMd  float64              `json:"estimate_md,omitempty"`
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
		t, err := svc.CreateTask(r.Context(), service.CreateTaskInput{
			TenantID:    tid,
			ProjectID:   projectID,
			ParentID:    req.ParentID,
			Code:        req.Code,
			Title:       req.Title,
			Description: req.Description,
			Type:        req.Type,
			Priority:    req.Priority,
			AssigneeID:  req.AssigneeID,
			ReviewerID:  req.ReviewerID,
			EstimateMd:  req.EstimateMd,
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


func listProjectTaskDeps(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		pid, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		deps, err := svc.Tasks.ListDepsForProject(r.Context(), tid, pid)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		if deps == nil {
			deps = []domain.TaskDependency{}
		}
		type depJSON struct {
			ID            string `json:"id"`
			PredecessorID string `json:"predecessorId"`
			SuccessorID   string `json:"successorId"`
			Type          string `json:"type"`
			LagDays       int    `json:"lagDays"`
		}
		out := make([]depJSON, len(deps))
		for i, d := range deps {
			out[i] = depJSON{
				ID:            d.ID.String(),
				PredecessorID: d.PredecessorID.String(),
				SuccessorID:   d.SuccessorID.String(),
				Type:          string(d.Type),
				LagDays:       d.LagDays,
			}
		}
		writeJSON(w, 200, out)
	}
}

// updateTaskReq fields are all optional so that a PATCH request only touches
// the fields the caller explicitly provided. String fields use *string so that
// callers can send `"title": ""` to clear a value. The legacy value-type
// fields (Title, Description, Type, Status, Priority) are converted to
// pointers during decoding via a custom json.RawMessage approach — we keep
// the approach simple by using json.Number / raw decode into the patch struct
// directly via pointer fields.
type updateTaskReqV2 struct {
	Title       *string              `json:"title"`
	Description *string              `json:"description"`
	Type        *domain.TaskType     `json:"type"`
	Status      *domain.TaskStatus   `json:"status"`
	Priority    *domain.TaskPriority `json:"priority"`
	AssigneeID  **uuid.UUID          `json:"assignee_id"`
	ReviewerID  **uuid.UUID          `json:"reviewer_id"`
	EstimateMd  *float64             `json:"estimate_md"`
	ActualMd    *float64             `json:"actual_md"`
	ProgressPct *int                 `json:"progress_pct"`
	SortOrder   *int                 `json:"sort_order"`
	Tags        *[]string            `json:"tags"`
	ParentID    **uuid.UUID          `json:"parent_id"`
	Version     int                  `json:"version"`
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
		var req updateTaskReqV2
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}

		// Build a TaskPatch with only the fields present in the request.
		// Nil fields are left untouched by the COALESCE UPDATE in the store.
		p := store.TaskPatch{
			TenantID:    tid,
			ID:          id,
			Version:     req.Version,
			EstimateMd:  req.EstimateMd,
			ActualMd:    req.ActualMd,
			ProgressPct: req.ProgressPct,
			SortOrder:   req.SortOrder,
			Tags:        req.Tags,
			AssigneeID:  req.AssigneeID,
			ReviewerID:  req.ReviewerID,
			ParentID:    req.ParentID,
		}
		if req.Title != nil {
			p.Title = req.Title
		}
		if req.Description != nil {
			p.Description = req.Description
		}
		if req.Type != nil {
			s := string(*req.Type)
			p.Type = &s
		}
		if req.Status != nil {
			s := string(*req.Status)
			p.Status = &s
		}
		if req.Priority != nil {
			s := string(*req.Priority)
			p.Priority = &s
		}

		// Extract caller identity from JWT claims for activity recording.
		callerID := ""
		if claims, ok := libauth.FromCtx(r.Context()); ok {
			callerID = claims.Subject
		}
		t, err := svc.PatchTask(r.Context(), service.PatchTaskInput{
			TaskPatch: p,
			ActorID:   callerID,
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

// --- Worklogs ---

// GET /tasks/{id}/worklogs
func listWorklogs(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		taskID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		entries, err := svc.Worklog.List(r.Context(), tid, taskID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		if entries == nil {
			entries = []domain.WorklogEntry{}
		}
		writeJSON(w, 200, map[string]any{"items": entries, "total": len(entries)})
	}
}

// POST /tasks/{id}/worklogs
func createWorklog(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		taskID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req struct {
			UserID   string  `json:"user_id"`
			LoggedMd float64 `json:"logged_md"`
			WorkDate string  `json:"work_date"`
			Note     string  `json:"note"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.LoggedMd <= 0 {
			writeErr(w, 400, errors.New("invalid body: logged_md must be > 0"))
			return
		}
		userID, err := uuid.Parse(req.UserID)
		if err != nil {
			writeErr(w, 400, errors.New("invalid user_id"))
			return
		}
		workDate := time.Now()
		if req.WorkDate != "" {
			workDate, err = time.Parse("2006-01-02", req.WorkDate)
			if err != nil {
				writeErr(w, 400, errors.New("invalid work_date, expected YYYY-MM-DD"))
				return
			}
		}
		entry, err := svc.Worklog.Create(r.Context(), tid, domain.CreateWorklogParams{
			TaskID:   taskID,
			UserID:   userID,
			LoggedMd: req.LoggedMd,
			WorkDate: workDate,
			Note:     req.Note,
		})
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 201, entry)
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
	Name        string               `json:"name"`
	Goal        string               `json:"goal,omitempty"`
	Status      domain.SprintStatus  `json:"status,omitempty"`
	StartDate   *string              `json:"start_date,omitempty"`
	EndDate     *string              `json:"end_date,omitempty"`
	CapacityPts int                  `json:"capacity_pts,omitempty"`
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
		parseOptDate := func(s *string) (*time.Time, error) {
			if s == nil || *s == "" {
				return nil, nil
			}
			if t, e := time.Parse("2006-01-02", *s); e == nil {
				return &t, nil
			}
			t, e := time.Parse(time.RFC3339, *s)
			if e != nil {
				return nil, e
			}
			return &t, nil
		}
		startDate, err := parseOptDate(req.StartDate)
		if err != nil {
			writeErr(w, 400, errors.New("invalid start_date format, expected YYYY-MM-DD"))
			return
		}
		endDate, err := parseOptDate(req.EndDate)
		if err != nil {
			writeErr(w, 400, errors.New("invalid end_date format, expected YYYY-MM-DD"))
			return
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
	Goal        *string             `json:"goal"`
	Status      domain.SprintStatus `json:"status,omitempty"`
	CapacityPts *int                `json:"capacity_pts,omitempty"`
	StartDate   *string             `json:"start_date,omitempty"`
	EndDate     *string             `json:"end_date,omitempty"`
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
		sp, err := svc.Sprints.GetByID(r.Context(), tid, id)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		if req.Name != "" {
			sp.Name = req.Name
		}
		if req.Goal != nil {
			sp.Goal = *req.Goal
		}
		if req.Status != "" {
			sp.Status = req.Status
		}
		if req.CapacityPts != nil {
			sp.CapacityPts = *req.CapacityPts
		}
		if req.StartDate != nil {
			if *req.StartDate == "" {
				sp.StartDate = nil
			} else {
				if t, e := time.Parse("2006-01-02", *req.StartDate); e == nil {
					sp.StartDate = &t
				} else if t, e := time.Parse(time.RFC3339, *req.StartDate); e == nil {
					sp.StartDate = &t
				} else {
					writeErr(w, 400, errors.New("invalid start_date format, expected YYYY-MM-DD"))
					return
				}
			}
		}
		if req.EndDate != nil {
			if *req.EndDate == "" {
				sp.EndDate = nil
			} else {
				if t, e := time.Parse("2006-01-02", *req.EndDate); e == nil {
					sp.EndDate = &t
				} else if t, e := time.Parse(time.RFC3339, *req.EndDate); e == nil {
					sp.EndDate = &t
				} else {
					writeErr(w, 400, errors.New("invalid end_date format, expected YYYY-MM-DD"))
					return
				}
			}
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

func deleteSprint(svc *service.Service) http.HandlerFunc {
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
		if err := svc.Sprints.Delete(r.Context(), tid, id); err != nil {
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

// --- Task Comments & Activity ---

// GET /tasks/{id}/comments
func listTaskComments(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		taskID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		comments, err := svc.Activity.ListComments(r.Context(), tid, taskID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		if comments == nil {
			comments = []domain.TaskComment{}
		}
		writeJSON(w, 200, map[string]any{"items": comments})
	}
}

type createCommentReq struct {
	Body     string `json:"body"`
	AuthorID string `json:"authorId"`
}

// POST /tasks/{id}/comments
func createTaskComment(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		taskID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		var req createCommentReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		if req.Body == "" {
			writeErr(w, 400, errors.New("body required"))
			return
		}
		authorID, _ := uuid.Parse(req.AuthorID)
		c, err := svc.Activity.CreateComment(r.Context(), tid, taskID, authorID, req.Body)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		// record activity event (best-effort: comment creation failure does not roll back the comment)
		_ = svc.Activity.RecordActivity(r.Context(), tid, taskID, &authorID, "commented", "", req.Body[:min(len(req.Body), 80)])
		writeJSON(w, 201, c)
	}
}

// GET /tasks/{id}/activity
func listTaskActivity(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid, ok := tenantOr400(w, r)
		if !ok {
			return
		}
		taskID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		acts, err := svc.Activity.ListActivity(r.Context(), tid, taskID)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		if acts == nil {
			acts = []domain.TaskActivity{}
		}
		writeJSON(w, 200, map[string]any{"items": acts})
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

