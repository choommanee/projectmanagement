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
	ID          uuid.UUID
	TenantID    uuid.UUID
	Code        string
	Name        string
	Description string
	Status      ProjectStatus
	OwnerID     *uuid.UUID
	StartDate   *time.Time
	DueDate     *time.Time
	ProgressPct int
	Tags        []string
	Settings    map[string]any
	CreatedAt   time.Time
	UpdatedAt   time.Time
	Version     int
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
	ID, TenantID, ProjectID uuid.UUID
	ParentID                *uuid.UUID
	Code                    string
	Title                   string
	Description             string
	Type                    TaskType
	Status                  TaskStatus
	Priority                TaskPriority
	AssigneeID              *uuid.UUID
	ReviewerID              *uuid.UUID
	EstimateMd              float64
	ActualMd                float64
	ProgressPct             int
	StartDate               *time.Time
	DueDate                 *time.Time
	SortOrder               int
	Tags                    []string
	CreatedAt               time.Time
	UpdatedAt               time.Time
	Version                 int
}

type DepType string

const (
	DepFS DepType = "fs"
	DepSS DepType = "ss"
	DepFF DepType = "ff"
	DepSF DepType = "sf"
)

type TaskDependency struct {
	ID                         uuid.UUID
	TenantID                   uuid.UUID
	PredecessorID, SuccessorID uuid.UUID
	Type                       DepType
	LagDays                    int
	CreatedAt                  time.Time
}

type SprintStatus string

const (
	SprintPlanning SprintStatus = "planning"
	SprintActive   SprintStatus = "active"
	SprintClosed   SprintStatus = "closed"
)

type Sprint struct {
	ID, TenantID, ProjectID uuid.UUID
	Name                    string
	Goal                    string
	Status                  SprintStatus
	StartDate, EndDate      *time.Time
	CapacityPts             int
	CreatedAt, UpdatedAt    time.Time
	Version                 int
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
