package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/pmplatform/services/project-svc/internal/domain"
	"github.com/pmplatform/services/project-svc/internal/service"
	"github.com/pmplatform/services/project-svc/internal/store"
)

func NewRouter(svc *service.Service) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})

	r.Route("/v1", func(r chi.Router) {
		// Projects
		r.Get("/projects", listProjects(svc))
		r.Post("/projects", createProject(svc))
		r.Get("/projects/{id}", getProject(svc))
		r.Patch("/projects/{id}", updateProject(svc))
		r.Delete("/projects/{id}", deleteProject(svc))

		// Tasks under project
		r.Get("/projects/{id}/tasks", listTasks(svc))
		r.Post("/projects/{id}/tasks", createTask(svc))

		// Tasks standalone
		r.Get("/tasks", listAllTasks(svc))
		r.Get("/tasks/{id}", getTask(svc))
		r.Patch("/tasks/{id}", updateTask(svc))
		r.Delete("/tasks/{id}", deleteTask(svc))
		r.Post("/tasks/{id}/dependencies", addDependency(svc))

		// Dependencies
		r.Delete("/dependencies/{id}", removeDependency(svc))

		// Sprints
		r.Get("/projects/{id}/sprints", listSprints(svc))
		r.Post("/projects/{id}/sprints", createSprint(svc))
		r.Get("/sprints/{id}", getSprint(svc))
		r.Patch("/sprints/{id}", updateSprint(svc))
		r.Get("/sprints/{id}/tasks", listSprintTasks(svc))
		r.Post("/sprints/{id}/tasks/{taskId}", assignTask(svc))
		r.Delete("/sprints/{id}/tasks/{taskId}", unassignTask(svc))
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
		p, err := svc.CreateProject(r.Context(), service.CreateProjectInput{
			TenantID:    tid,
			Code:        req.Code,
			Name:        req.Name,
			Description: req.Description,
			Status:      req.Status,
			OwnerID:     req.OwnerID,
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
		// Fetch current and apply patch
		p, err := svc.Projects.GetByID(r.Context(), tid, id)
		if err != nil {
			if errors.Is(err, domain.ErrNotFound) {
				writeErr(w, 404, err)
				return
			}
			writeErr(w, 500, err)
			return
		}
		if req.Name != "" {
			p.Name = req.Name
		}
		if req.Description != "" {
			p.Description = req.Description
		}
		if req.Status != "" {
			p.Status = req.Status
		}
		if req.OwnerID != nil {
			p.OwnerID = req.OwnerID
		}
		if req.ProgressPct != nil {
			p.ProgressPct = *req.ProgressPct
		}
		if req.Tags != nil {
			p.Tags = req.Tags
		}
		p.Version = req.Version
		if err := svc.Projects.Update(r.Context(), p); err != nil {
			switch {
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

type updateTaskReq struct {
	Title       string              `json:"title,omitempty"`
	Description string              `json:"description,omitempty"`
	Type        domain.TaskType     `json:"type,omitempty"`
	Status      domain.TaskStatus   `json:"status,omitempty"`
	Priority    domain.TaskPriority `json:"priority,omitempty"`
	AssigneeID  *uuid.UUID          `json:"assignee_id,omitempty"`
	ReviewerID  *uuid.UUID          `json:"reviewer_id,omitempty"`
	EstimateMd  *float64            `json:"estimate_md,omitempty"`
	ActualMd    *float64            `json:"actual_md,omitempty"`
	ProgressPct *int                `json:"progress_pct,omitempty"`
	SortOrder   *int                `json:"sort_order,omitempty"`
	Tags        []string            `json:"tags,omitempty"`
	ParentID    *uuid.UUID          `json:"parent_id,omitempty"`
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
		if req.AssigneeID != nil {
			t.AssigneeID = req.AssigneeID
		}
		if req.ReviewerID != nil {
			t.ReviewerID = req.ReviewerID
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
		if req.ParentID != nil {
			t.ParentID = req.ParentID
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
	Name        string               `json:"name"`
	Goal        string               `json:"goal,omitempty"`
	Status      domain.SprintStatus  `json:"status,omitempty"`
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
		sp, err := svc.CreateSprint(r.Context(), service.CreateSprintInput{
			TenantID:    tid,
			ProjectID:   projectID,
			Name:        req.Name,
			Goal:        req.Goal,
			Status:      req.Status,
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
		sp, err := svc.Sprints.GetByID(r.Context(), tid, id)
		if err != nil {
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
		if req.CapacityPts != nil {
			sp.CapacityPts = *req.CapacityPts
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

