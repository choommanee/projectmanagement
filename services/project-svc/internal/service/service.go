package service

import (
	"context"
	"strings"

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
	notif    notiflib.Publisher
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
	Description string
	Status      domain.ProjectStatus
	OwnerID     *uuid.UUID
	ProgressPct *int
	Tags        []string
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
	if in.Description != "" {
		p.Description = in.Description
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
	Priority            domain.TaskPriority
	AssigneeID          *uuid.UUID
	ReviewerID          *uuid.UUID
	EstimateMd          float64
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
	if in.Priority == "" {
		in.Priority = domain.PrioMed
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
		Status:      domain.TaskTodo,
		Priority:    in.Priority,
		AssigneeID:  in.AssigneeID,
		ReviewerID:  in.ReviewerID,
		EstimateMd:  in.EstimateMd,
		Tags:        []string{},
		Version:     1,
	}
	if err := svc.Tasks.Create(ctx, t); err != nil {
		return nil, err
	}
	return t, nil
}

// CreateSprintInput holds data for creating a sprint.
type CreateSprintInput struct {
	TenantID, ProjectID uuid.UUID
	Name, Goal          string
	Status              domain.SprintStatus
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
		CapacityPts: in.CapacityPts,
		Version:     1,
	}
	if err := svc.Sprints.Create(ctx, sp); err != nil {
		return nil, err
	}
	return sp, nil
}
