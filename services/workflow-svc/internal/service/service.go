package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	notiflib "github.com/pmplatform/libs/go/notification"

	"github.com/pmplatform/services/workflow-svc/internal/domain"
	"github.com/pmplatform/services/workflow-svc/internal/store"
)

type Service struct {
	Defs       *store.Definitions
	Versions   *store.Versions
	Instances  *store.Instances
	HumanTasks *store.HumanTasks
	Templates  *store.Templates
	RuntimeURL string
	notif      notiflib.Publisher
}

func New(defs *store.Definitions, vers *store.Versions, instances *store.Instances, ht *store.HumanTasks, runtimeURL string) *Service {
	return &Service{
		Defs:       defs,
		Versions:   vers,
		Instances:  instances,
		HumanTasks: ht,
		RuntimeURL: runtimeURL,
		notif:      notiflib.NoopPublisher{},
	}
}

// WithNotifPublisher attaches a notification publisher to the service.
// Returns the receiver for fluent wiring.
func (s *Service) WithNotifPublisher(pub notiflib.Publisher) *Service {
	s.notif = pub
	return s
}

// WithTemplates attaches the templates store to the service.
// Returns the receiver for fluent wiring.
func (s *Service) WithTemplates(t *store.Templates) *Service {
	s.Templates = t
	return s
}

// FireEventTriggers finds all published workflows triggered by the given event subject
// and starts an instance for each, injecting the event payload as input.
func (s *Service) FireEventTriggers(ctx context.Context, event string, payload map[string]any) error {
	defs, err := s.Defs.ListByEventTrigger(ctx, event)
	if err != nil || len(defs) == 0 {
		return err
	}
	inputBytes, _ := json.Marshal(payload)
	for _, def := range defs {
		_, _ = s.StartInstance(ctx, StartInstanceInput{
			TenantID:     def.TenantID,
			DefinitionID: def.ID,
			Input:        inputBytes,
		})
	}
	return nil
}

// ─── StartInstance ─────────────────────────────────────────────────────────────

type StartInstanceInput struct {
	TenantID     uuid.UUID
	DefinitionID uuid.UUID
	Input        json.RawMessage
}

type StartInstanceResult struct {
	Instance   *domain.WorkflowInstance `json:"instance"`
	Steps      []*domain.StepExecution  `json:"steps"`
	HumanTasks []*domain.HumanTask      `json:"human_tasks"`
}

func (s *Service) StartInstance(ctx context.Context, in StartInstanceInput) (*StartInstanceResult, error) {
	// Load current version
	ver, err := s.Versions.GetCurrent(ctx, in.TenantID, in.DefinitionID)
	if err != nil {
		return nil, fmt.Errorf("load version: %w", err)
	}

	input := in.Input
	if input == nil {
		input = json.RawMessage(`{}`)
	}

	// Create instance row
	inst := &domain.WorkflowInstance{
		ID:           uuid.New(),
		TenantID:     in.TenantID,
		DefinitionID: in.DefinitionID,
		VersionID:    ver.ID,
		Status:       domain.InstanceRunning,
		Input:        input,
		Variables:    json.RawMessage(`{}`),
		TriggerKind:  domain.TriggerManual,
	}
	if err := s.Instances.Create(ctx, inst); err != nil {
		return nil, fmt.Errorf("create instance: %w", err)
	}

	// Call runtime
	rr, err := s.callRuntime(ctx, domain.RuntimeRequest{
		InstanceID: &inst.ID,
		DSL:        ver.DSL,
		Input:      input,
		Variables:  json.RawMessage(`{}`),
	})
	if err != nil {
		// Runtime is down — mark failed
		errMsg := err.Error()
		inst.Status = domain.InstanceFailed
		inst.Error = &errMsg
		inst.Variables = json.RawMessage(`{}`)
		inst.Output = json.RawMessage(`null`)
		_ = s.Instances.UpdateStateAndSteps(ctx, in.TenantID, inst, nil, nil)
		return nil, fmt.Errorf("runtime error: %w", err)
	}

	return s.applyRuntimeResult(ctx, in.TenantID, inst, rr)
}

// ─── ResumeInstance ────────────────────────────────────────────────────────────

type ResumeInstanceInput struct {
	TenantID   uuid.UUID
	InstanceID uuid.UUID
	Input      json.RawMessage
}

func (s *Service) ResumeInstance(ctx context.Context, in ResumeInstanceInput) (*StartInstanceResult, error) {
	inst, err := s.Instances.GetByID(ctx, in.TenantID, in.InstanceID)
	if err != nil {
		return nil, err
	}
	ver, err := s.Versions.GetByID(ctx, in.TenantID, inst.VersionID)
	if err != nil {
		return nil, err
	}

	resumeInput := in.Input
	if resumeInput == nil {
		resumeInput = json.RawMessage(`{}`)
	}

	// Merge additional input into existing instance input
	var existing, extra map[string]any
	_ = json.Unmarshal(inst.Input, &existing)
	_ = json.Unmarshal(resumeInput, &extra)
	for k, v := range extra {
		existing[k] = v
	}
	mergedInput, _ := json.Marshal(existing)

	rr, err := s.callRuntime(ctx, domain.RuntimeRequest{
		InstanceID:       &inst.ID,
		DSL:              ver.DSL,
		Input:            mergedInput,
		Variables:        inst.Variables,
		ResumeFromStepID: inst.Cursor,
	})
	if err != nil {
		return nil, fmt.Errorf("runtime error: %w", err)
	}

	inst.Input = mergedInput
	return s.applyRuntimeResult(ctx, in.TenantID, inst, rr)
}

// ─── CancelInstance ────────────────────────────────────────────────────────────

func (s *Service) CancelInstance(ctx context.Context, tid, instID uuid.UUID) (*domain.WorkflowInstance, error) {
	inst, err := s.Instances.GetByID(ctx, tid, instID)
	if err != nil {
		return nil, err
	}
	if inst.Status == domain.InstanceCompleted || inst.Status == domain.InstanceCancelled {
		return inst, nil
	}
	inst.Status = domain.InstanceCancelled
	inst.Output = json.RawMessage(`null`)
	if err := s.Instances.UpdateStateAndSteps(ctx, tid, inst, nil, nil); err != nil {
		return nil, err
	}
	return inst, nil
}

// ─── CompleteHumanTask ────────────────────────────────────────────────────────

func (s *Service) CompleteHumanTask(ctx context.Context, tid, htID uuid.UUID, outcome string, data json.RawMessage) (*StartInstanceResult, error) {
	ht, err := s.HumanTasks.Complete(ctx, tid, htID, outcome, data)
	if err != nil {
		return nil, err
	}
	// Resume the parent instance
	return s.ResumeInstance(ctx, ResumeInstanceInput{
		TenantID:   tid,
		InstanceID: ht.InstanceID,
	})
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

func (s *Service) callRuntime(ctx context.Context, req domain.RuntimeRequest) (*domain.RuntimeResponse, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return nil, err
	}

	url := strings.TrimRight(s.RuntimeURL, "/") + "/execute"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("runtime returned %d: %s", resp.StatusCode, string(respBody))
	}

	var rr domain.RuntimeResponse
	if err := json.Unmarshal(respBody, &rr); err != nil {
		return nil, fmt.Errorf("parse runtime response: %w", err)
	}
	return &rr, nil
}

func (s *Service) applyRuntimeResult(
	ctx context.Context,
	tid uuid.UUID,
	inst *domain.WorkflowInstance,
	rr *domain.RuntimeResponse,
) (*StartInstanceResult, error) {
	// Map runtime status to domain status
	switch rr.Status {
	case "completed":
		inst.Status = domain.InstanceCompleted
	case "paused":
		inst.Status = domain.InstancePaused
	case "failed":
		inst.Status = domain.InstanceFailed
	default:
		inst.Status = domain.InstanceRunning
	}

	inst.Variables = rr.Variables
	if rr.Variables == nil {
		inst.Variables = json.RawMessage(`{}`)
	}
	inst.Output = rr.Output
	inst.Cursor = rr.Cursor
	inst.Error = rr.Error

	// Build step executions
	steps := make([]domain.StepExecution, 0, len(rr.Steps))
	for _, rs := range rr.Steps {
		se := domain.StepExecution{
			ID:         uuid.New(),
			TenantID:   tid,
			InstanceID: inst.ID,
			StepID:     rs.StepID,
			StepType:   rs.StepType,
			Status:     domain.StepStatus(rs.Status),
			Input:      rs.Input,
			Output:     rs.Output,
			Error:      rs.Error,
			StartedAt:  time.Now(),
		}
		if rs.Status != "running" {
			now := time.Now()
			se.EndedAt = &now
		}
		steps = append(steps, se)
	}

	// Build human tasks
	humanTasks := make([]domain.HumanTask, 0, len(rr.HumanTasks))
	for _, rht := range rr.HumanTasks {
		ht := domain.HumanTask{
			ID:         uuid.New(),
			TenantID:   tid,
			InstanceID: inst.ID,
			StepID:     rht.StepID,
			Form:       rht.Form,
		}
		if rht.Assignee != nil && *rht.Assignee != "" {
			// Store assignee string in the AssigneeID field if it's a UUID
			if aid, err := uuid.Parse(*rht.Assignee); err == nil {
				ht.AssigneeID = &aid
			}
			// If not a UUID, we still create the task but without assignee_id
		}
		humanTasks = append(humanTasks, ht)
	}

	if err := s.Instances.UpdateStateAndSteps(ctx, tid, inst, steps, humanTasks); err != nil {
		return nil, fmt.Errorf("persist result: %w", err)
	}

	if inst.Status == domain.InstanceCompleted && s.notif != nil {
		_ = s.notif.Publish(ctx, notiflib.Event{
			TenantID: tid.String(),
			UserID:   tid.String(), // best-effort: no actor in workflow runtime response
			Kind:     "workflow.instance.completed",
			Title:    "Workflow instance completed",
		})
	}

	// Load persisted steps
	persistedSteps, _ := s.Instances.ListSteps(ctx, tid, inst.ID)

	// Load human tasks
	htList, _, _ := s.HumanTasks.List(ctx, tid, store.ListHumanTasksOpts{
		InstanceID: &inst.ID,
		Limit:      200,
	})

	return &StartInstanceResult{
		Instance:   inst,
		Steps:      persistedSteps,
		HumanTasks: htList,
	}, nil
}
