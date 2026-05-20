package domain

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
)

// ─── Enums ────────────────────────────────────────────────────────────────────

type WorkflowStatus string

const (
	WorkflowDraft     WorkflowStatus = "draft"
	WorkflowPublished WorkflowStatus = "published"
	WorkflowArchived  WorkflowStatus = "archived"
)

type InstanceStatus string

const (
	InstanceRunning   InstanceStatus = "running"
	InstancePaused    InstanceStatus = "paused"
	InstanceCompleted InstanceStatus = "completed"
	InstanceFailed    InstanceStatus = "failed"
	InstanceCancelled InstanceStatus = "cancelled"
)

type StepStatus string

const (
	StepRunning   StepStatus = "running"
	StepCompleted StepStatus = "completed"
	StepFailed    StepStatus = "failed"
	StepSkipped   StepStatus = "skipped"
)

type TriggerKind string

const (
	TriggerEvent    TriggerKind = "event"
	TriggerManual   TriggerKind = "manual"
	TriggerSchedule TriggerKind = "schedule"
	TriggerWebhook  TriggerKind = "webhook"
	TriggerRecord   TriggerKind = "record"
)

// ─── Core types ───────────────────────────────────────────────────────────────

type WorkflowDefinition struct {
	ID             uuid.UUID       `json:"id"`
	TenantID       uuid.UUID       `json:"tenant_id"`
	Name           string          `json:"name"`
	Description    string          `json:"description,omitempty"`
	Trigger        json.RawMessage `json:"trigger"`
	Status         WorkflowStatus  `json:"status"`
	CurrentVersion int             `json:"current_version"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
	Version        int             `json:"version"`
}

type WorkflowVersion struct {
	ID           uuid.UUID       `json:"id"`
	TenantID     uuid.UUID       `json:"tenant_id"`
	DefinitionID uuid.UUID       `json:"definition_id"`
	Rev          int             `json:"rev"`
	DSL          json.RawMessage `json:"dsl"`
	PublishedAt  *time.Time      `json:"published_at,omitempty"`
	CreatedBy    *uuid.UUID      `json:"created_by,omitempty"`
	Notes        string          `json:"notes,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
}

type WorkflowInstance struct {
	ID           uuid.UUID       `json:"id"`
	TenantID     uuid.UUID       `json:"tenant_id"`
	DefinitionID uuid.UUID       `json:"definition_id"`
	VersionID    uuid.UUID       `json:"version_id"`
	Status       InstanceStatus  `json:"status"`
	Input        json.RawMessage `json:"input"`
	Output       json.RawMessage `json:"output,omitempty"`
	Variables    json.RawMessage `json:"variables"`
	Cursor       *string         `json:"cursor,omitempty"`
	Error        *string         `json:"error,omitempty"`
	TriggerKind  TriggerKind     `json:"trigger_kind"`
	StartedAt    time.Time       `json:"started_at"`
	EndedAt      *time.Time      `json:"ended_at,omitempty"`
}

type StepExecution struct {
	ID         uuid.UUID       `json:"id"`
	TenantID   uuid.UUID       `json:"tenant_id"`
	InstanceID uuid.UUID       `json:"instance_id"`
	StepID     string          `json:"step_id"`
	StepType   string          `json:"step_type"`
	Status     StepStatus      `json:"status"`
	Input      json.RawMessage `json:"input,omitempty"`
	Output     json.RawMessage `json:"output,omitempty"`
	Error      *string         `json:"error,omitempty"`
	StartedAt  time.Time       `json:"started_at"`
	EndedAt    *time.Time      `json:"ended_at,omitempty"`
}

type HumanTask struct {
	ID          uuid.UUID       `json:"id"`
	TenantID    uuid.UUID       `json:"tenant_id"`
	InstanceID  uuid.UUID       `json:"instance_id"`
	StepID      string          `json:"step_id"`
	AssigneeID  *uuid.UUID      `json:"assignee_id,omitempty"`
	Form        json.RawMessage `json:"form"`
	Data        json.RawMessage `json:"data,omitempty"`
	Outcome     *string         `json:"outcome,omitempty"`
	SLADeadline *time.Time      `json:"sla_deadline,omitempty"`
	EscalateTo  *uuid.UUID      `json:"escalate_to,omitempty"`
	CreatedAt   time.Time       `json:"created_at"`
	CompletedAt *time.Time      `json:"completed_at,omitempty"`
}

// ─── Runtime I/O ──────────────────────────────────────────────────────────────

// RuntimeRequest is what we POST to /execute on workflow-runtime.
type RuntimeRequest struct {
	InstanceID       *uuid.UUID      `json:"instance_id,omitempty"`
	DSL              json.RawMessage `json:"dsl"`
	Input            json.RawMessage `json:"input"`
	Variables        json.RawMessage `json:"variables"`
	ResumeFromStepID *string         `json:"resume_from_step_id,omitempty"`
}

// RuntimeStepResult mirrors the Rust step result.
type RuntimeStepResult struct {
	StepID     string          `json:"step_id"`
	StepType   string          `json:"step_type"`
	Status     string          `json:"status"`
	Input      json.RawMessage `json:"input"`
	Output     json.RawMessage `json:"output"`
	Error      *string         `json:"error"`
	DurationMs int64           `json:"duration_ms"`
}

// RuntimeHumanTask mirrors the Rust human_task result.
type RuntimeHumanTask struct {
	StepID   string          `json:"step_id"`
	Assignee *string         `json:"assignee"`
	Form     json.RawMessage `json:"form"`
}

// RuntimeResponse is what the Rust engine returns.
type RuntimeResponse struct {
	Status     string               `json:"status"`
	Variables  json.RawMessage      `json:"variables"`
	Output     json.RawMessage      `json:"output"`
	Cursor     *string              `json:"cursor"`
	Error      *string              `json:"error"`
	Steps      []RuntimeStepResult  `json:"steps"`
	HumanTasks []RuntimeHumanTask   `json:"human_tasks"`
}

// ─── Errors ───────────────────────────────────────────────────────────────────

var (
	ErrNotFound     = errors.New("not found")
	ErrConflict     = errors.New("version conflict")
	ErrInvalidInput = errors.New("invalid input")
)
