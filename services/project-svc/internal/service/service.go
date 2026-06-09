package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	notiflib "github.com/pmplatform/libs/go/notification"

	"github.com/pmplatform/services/project-svc/internal/domain"
	"github.com/pmplatform/services/project-svc/internal/store"
)

type Service struct {
	Projects *store.Projects
	Tasks    *store.Tasks
	Sprints  *store.Sprints
	Worklog  *store.WorklogStore
	Activity *store.ActivityStore
	notif    notiflib.Publisher
	audit    AuditPublisher
}

func New(p *store.Projects, t *store.Tasks, s *store.Sprints) *Service {
	return &Service{Projects: p, Tasks: t, Sprints: s, notif: notiflib.NoopPublisher{}}
}

// WithNotifPublisher attaches a notification publisher to the service.
// Returns the receiver for fluent wiring.
func (svc *Service) WithNotifPublisher(pub notiflib.Publisher) *Service {
	svc.notif = pub
	return svc
}

// WithActivity attaches the activity/comment store to the service.
// Returns the receiver for fluent wiring.
func (svc *Service) WithActivity(a *store.ActivityStore) *Service {
	svc.Activity = a
	return svc
}

// CreateProjectInput holds data for creating a project.
type CreateProjectInput struct {
	TenantID                uuid.UUID
	Code, Name, Description string
	Status                  domain.ProjectStatus
	OwnerID                 *uuid.UUID
	ActorID                 string // caller user ID for notification routing (optional)
}

// CreateProject validates and creates a new project.
func (svc *Service) CreateProject(ctx context.Context, in CreateProjectInput) (*domain.Project, error) {
	if err := domain.ValidateCode(strings.ToUpper(in.Code)); err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.Name) == "" {
		return nil, domain.ErrInvalidInput
	}
	if in.Status == "" {
		in.Status = domain.ProjectPlanning
	}
	p := &domain.Project{
		ID:          uuid.New(),
		TenantID:    in.TenantID,
		Code:        strings.ToUpper(in.Code),
		Name:        in.Name,
		Description: in.Description,
		Status:      in.Status,
		OwnerID:     in.OwnerID,
		Tags:        []string{},
		Settings:    map[string]any{},
		Version:     1,
	}
	if err := svc.Projects.Create(ctx, p); err != nil {
		return nil, err
	}
	actorID := in.ActorID
	if actorID == "" && p.OwnerID != nil {
		actorID = p.OwnerID.String()
	}
	if actorID == "" {
		actorID = p.TenantID.String()
	}
	if svc.notif != nil {
		_ = svc.notif.Publish(ctx, notiflib.Event{
			TenantID: p.TenantID.String(),
			UserID:   actorID,
			Kind:     "project.created",
			Title:    "Project created: " + p.Name,
		})
	}
	return p, nil
}

// UpdateProjectInput holds data for updating a project.
type UpdateProjectInput struct {
	TenantID    uuid.UUID
	ID          uuid.UUID
	Name        string
	Description *string // nil = no change; pointer to "" = clear
	Status      domain.ProjectStatus
	OwnerID     *uuid.UUID
	ProgressPct *int
	Tags        []string
	StartDate   **time.Time // outer nil = no change; inner nil = clear
	DueDate     **time.Time
	Version     int
	UserID      string // caller, for notification routing
}

// UpdateProject applies a patch to an existing project and publishes a
// "project.updated" notification event on success.
func (svc *Service) UpdateProject(ctx context.Context, in UpdateProjectInput) (*domain.Project, error) {
	p, err := svc.Projects.GetByID(ctx, in.TenantID, in.ID)
	if err != nil {
		return nil, err
	}
	if in.Name != "" {
		p.Name = in.Name
	}
	if in.Description != nil {
		p.Description = *in.Description // pointer to "" clears
	}
	if in.Status != "" {
		p.Status = in.Status
	}
	if in.OwnerID != nil {
		p.OwnerID = in.OwnerID
	}
	if in.ProgressPct != nil {
		p.ProgressPct = *in.ProgressPct
	}
	if in.Tags != nil {
		p.Tags = in.Tags
	}
	if in.StartDate != nil {
		p.StartDate = *in.StartDate // inner nil clears
	}
	if in.DueDate != nil {
		p.DueDate = *in.DueDate
	}
	p.Version = in.Version
	if err := svc.Projects.Update(ctx, p); err != nil {
		return nil, err
	}
	userID := in.UserID
	if userID == "" {
		userID = p.TenantID.String()
	}
	if svc.notif != nil {
		_ = svc.notif.Publish(ctx, notiflib.Event{
			TenantID: p.TenantID.String(),
			UserID:   userID,
			Kind:     "project.updated",
			Title:    "Project updated: " + p.Name,
		})
	}
	return p, nil
}

// CreateTaskInput holds data for creating a task.
type CreateTaskInput struct {
	TenantID, ProjectID uuid.UUID
	ParentID            *uuid.UUID
	Code, Title         string
	Description         string
	Type                domain.TaskType
	Status              domain.TaskStatus
	Priority            domain.TaskPriority
	AssigneeID          *uuid.UUID
	ReviewerID          *uuid.UUID
	EstimateMd          float64
	StartDate           *time.Time
	DueDate             *time.Time
	Tags                []string
}

// CreateTask validates and creates a new task.
func (svc *Service) CreateTask(ctx context.Context, in CreateTaskInput) (*domain.Task, error) {
	if err := domain.ValidateCode(strings.ToUpper(in.Code)); err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.Title) == "" {
		return nil, domain.ErrInvalidInput
	}
	if in.Type == "" {
		in.Type = domain.TaskTypeTask
	}
	switch in.Status {
	case "":
		in.Status = domain.TaskTodo
	case domain.TaskTodo, domain.TaskInProgress, domain.TaskBlocked,
		domain.TaskReview, domain.TaskDone, domain.TaskCancelled:
		// valid as-is
	default:
		return nil, domain.ErrInvalidInput
	}
	if in.Priority == "" {
		in.Priority = domain.PrioMed
	}
	if in.Tags == nil {
		in.Tags = []string{}
	}
	t := &domain.Task{
		ID:          uuid.New(),
		TenantID:    in.TenantID,
		ProjectID:   in.ProjectID,
		ParentID:    in.ParentID,
		Code:        strings.ToUpper(in.Code),
		Title:       in.Title,
		Description: in.Description,
		Type:        in.Type,
		Status:      in.Status,
		Priority:    in.Priority,
		AssigneeID:  in.AssigneeID,
		ReviewerID:  in.ReviewerID,
		EstimateMd:  in.EstimateMd,
		StartDate:   in.StartDate,
		DueDate:     in.DueDate,
		Tags:        in.Tags,
		Version:     1,
	}
	if err := svc.Tasks.Create(ctx, t); err != nil {
		return nil, err
	}
	return t, nil
}

// PatchTaskInput holds data for patching a task.
type PatchTaskInput struct {
	store.TaskPatch
	ActorID string // caller user ID, for activity + notification routing
}

// PatchTask fetches the existing task, applies the patch, records activity for
// changed fields, and publishes notifications for important changes.
func (svc *Service) PatchTask(ctx context.Context, in PatchTaskInput) (*domain.Task, error) {
	// Fetch existing to diff
	existing, err := svc.Tasks.GetByID(ctx, in.TenantID, in.ID)
	if err != nil {
		return nil, err
	}

	updated, err := svc.Tasks.Patch(ctx, in.TaskPatch)
	if err != nil {
		return nil, err
	}

	// Parse actor UUID once; nil is valid for system-generated events.
	var actorUUID *uuid.UUID
	if in.ActorID != "" {
		if uid, err2 := uuid.Parse(in.ActorID); err2 == nil {
			actorUUID = &uid
		}
	}

	// Record activity for each changed field.
	if svc.Activity != nil {
		if in.Status != nil && string(existing.Status) != *in.Status {
			_ = svc.Activity.RecordActivity(ctx, in.TenantID, in.ID, actorUUID,
				"status_changed", string(existing.Status), *in.Status)
		}
		if in.Priority != nil && string(existing.Priority) != *in.Priority {
			_ = svc.Activity.RecordActivity(ctx, in.TenantID, in.ID, actorUUID,
				"priority_changed", string(existing.Priority), *in.Priority)
		}
		if in.AssigneeID != nil {
			oldVal := ""
			if existing.AssigneeID != nil {
				oldVal = existing.AssigneeID.String()
			}
			newVal := ""
			if *in.AssigneeID != nil {
				newVal = (*in.AssigneeID).String()
			}
			if oldVal != newVal {
				_ = svc.Activity.RecordActivity(ctx, in.TenantID, in.ID, actorUUID,
					"assigned", oldVal, newVal)
			}
		}
	}

	// Notify when the assignee changes.
	if svc.notif != nil && in.AssigneeID != nil && updated.AssigneeID != nil {
		oldAssignee := ""
		if existing.AssigneeID != nil {
			oldAssignee = existing.AssigneeID.String()
		}
		if oldAssignee != updated.AssigneeID.String() {
			_ = svc.notif.Publish(ctx, notiflib.Event{
				TenantID: in.TenantID.String(),
				UserID:   updated.AssigneeID.String(),
				Kind:     "task.assigned",
				Title:    "You have been assigned to: " + updated.Title,
				Body:     updated.Code + " — " + updated.Title,
			})
		}
	}

	// Notify when status transitions to blocked.
	if svc.notif != nil && in.Status != nil && *in.Status == "blocked" && string(existing.Status) != "blocked" {
		targetID := in.ActorID
		if updated.AssigneeID != nil {
			targetID = updated.AssigneeID.String()
		}
		if targetID != "" {
			_ = svc.notif.Publish(ctx, notiflib.Event{
				TenantID: in.TenantID.String(),
				UserID:   targetID,
				Kind:     "task.blocked",
				Title:    "Task blocked: " + updated.Title,
				Body:     updated.Code + " has been marked as blocked.",
			})
		}
	}

	return updated, nil
}

// CreateSprintInput holds data for creating a sprint.
type CreateSprintInput struct {
	TenantID, ProjectID uuid.UUID
	Name, Goal          string
	Status              domain.SprintStatus
	StartDate, EndDate  *time.Time
	CapacityPts         int
}

// CreateSprint creates a new sprint.
func (svc *Service) CreateSprint(ctx context.Context, in CreateSprintInput) (*domain.Sprint, error) {
	if strings.TrimSpace(in.Name) == "" {
		return nil, domain.ErrInvalidInput
	}
	if in.Status == "" {
		in.Status = domain.SprintPlanning
	}
	sp := &domain.Sprint{
		ID:          uuid.New(),
		TenantID:    in.TenantID,
		ProjectID:   in.ProjectID,
		Name:        in.Name,
		Goal:        in.Goal,
		Status:      in.Status,
		StartDate:   in.StartDate,
		EndDate:     in.EndDate,
		CapacityPts: in.CapacityPts,
		Version:     1,
	}
	if err := svc.Sprints.Create(ctx, sp); err != nil {
		return nil, err
	}
	return sp, nil
}
