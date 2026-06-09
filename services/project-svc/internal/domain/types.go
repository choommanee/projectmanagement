package domain

import (
	"errors"
	"regexp"
	"time"

	"github.com/google/uuid"
)

type ProjectStatus string

const (
	ProjectPlanning  ProjectStatus = "planning"
	ProjectActive    ProjectStatus = "active"
	ProjectOnHold    ProjectStatus = "on_hold"
	ProjectCompleted ProjectStatus = "completed"
	ProjectCancelled ProjectStatus = "cancelled"
)

type Project struct {
	ID          uuid.UUID      `json:"id"`
	TenantID    uuid.UUID      `json:"tenant_id"`
	Code        string         `json:"code"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Status      ProjectStatus  `json:"status"`
	OwnerID     *uuid.UUID     `json:"owner_id"`
	StartDate   *time.Time     `json:"start_date"`
	DueDate     *time.Time     `json:"due_date"`
	ProgressPct int            `json:"progress_pct"`
	Tags        []string       `json:"tags"`
	Settings    map[string]any `json:"settings"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	Version     int            `json:"version"`
}

type TaskType string

const (
	TaskTypeTask        TaskType = "task"
	TaskTypeSubtask     TaskType = "subtask"
	TaskTypeMilestone   TaskType = "milestone"
	TaskTypeDeliverable TaskType = "deliverable"
	TaskTypeIssue       TaskType = "issue"
	TaskTypeRisk        TaskType = "risk"
	TaskTypeBug         TaskType = "bug"
)

type TaskStatus string

const (
	TaskTodo       TaskStatus = "todo"
	TaskInProgress TaskStatus = "in_progress"
	TaskBlocked    TaskStatus = "blocked"
	TaskReview     TaskStatus = "review"
	TaskDone       TaskStatus = "done"
	TaskCancelled  TaskStatus = "cancelled"
)

type TaskPriority string

const (
	PrioLow      TaskPriority = "low"
	PrioMed      TaskPriority = "med"
	PrioHigh     TaskPriority = "high"
	PrioCritical TaskPriority = "critical"
)

type Task struct {
	ID          uuid.UUID    `json:"id"`
	TenantID    uuid.UUID    `json:"tenant_id"`
	ProjectID   uuid.UUID    `json:"project_id"`
	ParentID    *uuid.UUID   `json:"parent_id"`
	Code        string       `json:"code"`
	Title       string       `json:"title"`
	Description string       `json:"description"`
	Type        TaskType     `json:"type"`
	Status      TaskStatus   `json:"status"`
	Priority    TaskPriority `json:"priority"`
	AssigneeID  *uuid.UUID   `json:"assignee_id"`
	ReviewerID  *uuid.UUID   `json:"reviewer_id"`
	EstimateMd  float64      `json:"estimate_md"`
	ActualMd    float64      `json:"actual_md"`
	ProgressPct int          `json:"progress_pct"`
	StartDate   *time.Time   `json:"start_date"`
	DueDate     *time.Time   `json:"due_date"`
	SortOrder   int          `json:"sort_order"`
	Tags        []string     `json:"tags"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
	Version     int          `json:"version"`
}

type DepType string

const (
	DepFS DepType = "fs"
	DepSS DepType = "ss"
	DepFF DepType = "ff"
	DepSF DepType = "sf"
)

type TaskDependency struct {
	ID            uuid.UUID `json:"id"`
	TenantID      uuid.UUID `json:"tenant_id"`
	PredecessorID uuid.UUID `json:"predecessor_id"`
	SuccessorID   uuid.UUID `json:"successor_id"`
	Type          DepType   `json:"type"`
	LagDays       int       `json:"lag_days"`
	CreatedAt     time.Time `json:"created_at"`
}

type SprintStatus string

const (
	SprintPlanning SprintStatus = "planning"
	SprintActive   SprintStatus = "active"
	SprintClosed   SprintStatus = "closed"
)

type Sprint struct {
	ID          uuid.UUID    `json:"id"`
	TenantID    uuid.UUID    `json:"tenant_id"`
	ProjectID   uuid.UUID    `json:"project_id"`
	Name        string       `json:"name"`
	Goal        string       `json:"goal"`
	Status      SprintStatus `json:"status"`
	StartDate   *time.Time   `json:"start_date"`
	EndDate     *time.Time   `json:"end_date"`
	CapacityPts int          `json:"capacity_pts"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
	Version     int          `json:"version"`
}

var (
	ErrNotFound     = errors.New("not found")
	ErrConflict     = errors.New("version conflict")
	ErrInvalidCode  = errors.New("invalid code")
	ErrInvalidInput = errors.New("invalid input")
)

var codeRe = regexp.MustCompile(`^[A-Z][A-Z0-9-]{1,31}$`)

func ValidateCode(c string) error {
	if !codeRe.MatchString(c) {
		return ErrInvalidCode
	}
	return nil
}

type WorklogEntry struct {
	ID        uuid.UUID `json:"id"`
	TenantID  uuid.UUID `json:"tenant_id"`
	TaskID    uuid.UUID `json:"task_id"`
	UserID    uuid.UUID `json:"user_id"`
	LoggedMd  float64   `json:"logged_md"`
	WorkDate  time.Time `json:"work_date"`
	Note      string    `json:"note"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type CreateWorklogParams struct {
	TaskID   uuid.UUID
	UserID   uuid.UUID
	LoggedMd float64
	WorkDate time.Time
	Note     string
}

// UpdateWorklogParams carries the editable fields for a worklog entry.
// Nil pointers mean "leave unchanged". Version is the optimistic-lock guard.
type UpdateWorklogParams struct {
	ID       uuid.UUID
	LoggedMd *float64
	WorkDate *time.Time
	Note     *string
	Version  int
}
