package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/pmplatform/libs/go/audit"
	notiflib "github.com/pmplatform/libs/go/notification"
	"github.com/pmplatform/libs/go/serviceauth"

	"github.com/pmplatform/services/workflow-svc/internal/domain"
	"github.com/pmplatform/services/workflow-svc/internal/store"
)

// tokenMinter is the subset of serviceauth.Client the service depends on. It is
// an interface so tests can stub token minting without an identity-svc.
type tokenMinter interface {
	TokenFor(ctx context.Context, tenantID string) (string, error)
}

// AuditPublisher is satisfied by *audit.PgPublisher and *audit.Fallback.
type AuditPublisher interface {
	Publish(ctx context.Context, action string, ev audit.Event) error
}

type Service struct {
	Defs       *store.Definitions
	Versions   *store.Versions
	Instances  *store.Instances
	HumanTasks *store.HumanTasks
	Templates  *store.Templates
	RuntimeURL string
	notif      notiflib.Publisher
	svcAuth    tokenMinter

	// Audit records significant mutations to audit_log. Optional: nil makes
	// the audit helper a no-op.
	Audit AuditPublisher
}

// WithAudit attaches an audit publisher and returns the service for chaining.
func (s *Service) WithAudit(p AuditPublisher) *Service {
	s.Audit = p
	return s
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

// WithServiceAuth attaches a service-to-service token minter so the service can
// forward an Authorization bearer token (and tenant) to the runtime engine,
// which in turn forwards it to document-svc / project-svc. Passing nil leaves
// the service in degraded mode (no token sent) for local dev without auth.
func (s *Service) WithServiceAuth(sa tokenMinter) *Service {
	if sa == nil {
		return s
	}
	s.svcAuth = sa
	return s
}

// Compile-time assertion that the real client satisfies the minter interface.
var _ tokenMinter = (*serviceauth.Client)(nil)

// authFor obtains a service token for the tenant and returns the token + tenant
// id to attach to a runtime request. When no minter is configured (degraded
// local dev) or minting fails, it returns nils and the request carries no auth
// header — the runtime still runs, only cross-service calls go unauthenticated.
func (s *Service) authFor(ctx context.Context, tid uuid.UUID) (*string, *string) {
	tenantStr := tid.String()
	if s.svcAuth == nil {
		return nil, &tenantStr
	}
	tok, err := s.svcAuth.TokenFor(ctx, tenantStr)
	if err != nil {
		log.Warn().Err(err).Str("tenant_id", tenantStr).
			Msg("serviceauth token mint failed — sending runtime request without auth")
		return nil, &tenantStr
	}
	return &tok, &tenantStr
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
	authTok, tenantStr := s.authFor(ctx, in.TenantID)
	rr, err := s.callRuntime(ctx, domain.RuntimeRequest{
		InstanceID: &inst.ID,
		DSL:        ver.DSL,
		Input:      input,
		Variables:  json.RawMessage(`{}`),
		AuthToken:  authTok,
		TenantID:   tenantStr,
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

	authTok, tenantStr := s.authFor(ctx, in.TenantID)
	resumeInclusive := true // skip the paused (human_task / wait / signature) step
	rr, err := s.callRuntime(ctx, domain.RuntimeRequest{
		InstanceID:       &inst.ID,
		DSL:              ver.DSL,
		Input:            mergedInput,
		Variables:        inst.Variables,
		ResumeFromStepID: inst.Cursor,
		ResumeInclusive:  &resumeInclusive,
		AuthToken:        authTok,
		TenantID:         tenantStr,
	})
	if err != nil {
		// Runtime unreachable on resume — mark failed so it can be retried
		// and never gets stuck in paused/running.
		errMsg := err.Error()
		inst.Status = domain.InstanceFailed
		inst.Error = &errMsg
		inst.Input = mergedInput
		_ = s.Instances.UpdateStateAndSteps(ctx, in.TenantID, inst, nil, nil)
		return nil, fmt.Errorf("runtime error: %w", err)
	}

	inst.Input = mergedInput
	return s.applyRuntimeResult(ctx, in.TenantID, inst, rr)
}

// ─── ResumeBySignature ─────────────────────────────────────────────────────────

// ResumeBySignature handles a document-svc signature outcome event
// (document.sign_completed / document.sign_declined). It finds the paused
// instance awaiting the given envelope, injects {signature_outcome: signed|
// declined} into the resume input so the following `switch` can branch, and
// resumes (resume_inclusive=true skips the request_signature step). The
// pending_envelope_id is cleared on resume (applyRuntimeResult resets it unless
// the engine pauses on a new signature step).
//
// outcome must be "signed" or "declined". The lookup is tenant-scoped via RLS.
// A missing instance is not an error — the event may target an envelope this
// service did not originate — so it returns (nil, nil) in that case.
func (s *Service) ResumeBySignature(ctx context.Context, tid, envelopeID uuid.UUID, outcome string) (*StartInstanceResult, error) {
	inst, err := s.Instances.FindPausedByEnvelope(ctx, tid, envelopeID)
	if errors.Is(err, domain.ErrNotFound) {
		log.Debug().Str("envelope_id", envelopeID.String()).Str("tenant_id", tid.String()).
			Msg("no paused instance awaiting signature envelope — ignoring event")
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	resume, _ := json.Marshal(map[string]any{"signature_outcome": outcome})
	return s.ResumeInstance(ctx, ResumeInstanceInput{
		TenantID:   tid,
		InstanceID: inst.ID,
		Input:      resume,
	})
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

	// Inject the chosen outcome (and any submitted form data) into the resume
	// input so a following `switch` can branch on it. The engine evaluates
	// expressions like `input.last_outcome == "approved"` against this input.
	//   - input.last_outcome        — the most recent human_task outcome
	//   - input.<stepID>_outcome    — addressable per-step outcome
	//   - merged data fields        — each submitted field at input top level
	resume := map[string]any{
		"last_outcome": outcome,
	}
	if ht.StepID != "" {
		resume[ht.StepID+"_outcome"] = outcome
	}
	if len(data) > 0 {
		var fields map[string]any
		if err := json.Unmarshal(data, &fields); err == nil {
			for k, v := range fields {
				resume[k] = v
			}
		}
	}
	resumeBytes, _ := json.Marshal(resume)

	// Resume the parent instance
	return s.ResumeInstance(ctx, ResumeInstanceInput{
		TenantID:   tid,
		InstanceID: ht.InstanceID,
		Input:      resumeBytes,
	})
}

// ─── RetryInstance ──────────────────────────────────────────────────────────

// RetryInstance re-runs a FAILED instance, RE-EXECUTING the step it failed on
// (the cursor) rather than skipping past it. This is the key difference from a
// human_task / wait resume: those skip the paused step (resume_inclusive=true),
// whereas a retry must re-run the failed cursor step (resume_inclusive=false),
// otherwise the failed step is silently skipped and the instance falsely
// completes. If there is no cursor (it failed on the first step) the engine
// re-runs from the beginning. Non-failed instances are rejected.
func (s *Service) RetryInstance(ctx context.Context, tid, instID uuid.UUID) (*StartInstanceResult, error) {
	inst, err := s.Instances.GetByID(ctx, tid, instID)
	if err != nil {
		return nil, err
	}
	if inst.Status != domain.InstanceFailed {
		return nil, fmt.Errorf("%w: instance is %s, only failed instances can be retried", domain.ErrInvalidInput, inst.Status)
	}
	ver, err := s.Versions.GetByID(ctx, tid, inst.VersionID)
	if err != nil {
		return nil, err
	}

	authTok, tenantStr := s.authFor(ctx, tid)
	resumeInclusive := false // re-execute the failed cursor step
	rr, err := s.callRuntime(ctx, domain.RuntimeRequest{
		InstanceID:       &inst.ID,
		DSL:              ver.DSL,
		Input:            inst.Input,
		Variables:        inst.Variables,
		ResumeFromStepID: inst.Cursor,
		ResumeInclusive:  &resumeInclusive,
		AuthToken:        authTok,
		TenantID:         tenantStr,
	})
	if err != nil {
		errMsg := err.Error()
		inst.Status = domain.InstanceFailed
		inst.Error = &errMsg
		_ = s.Instances.UpdateStateAndSteps(ctx, tid, inst, nil, nil)
		return nil, fmt.Errorf("runtime error: %w", err)
	}
	return s.applyRuntimeResult(ctx, tid, inst, rr)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

// publish emits a notification event, tolerating a nil publisher and swallowing
// delivery errors (notifications are best-effort and never block the workflow).
func (s *Service) publish(ctx context.Context, ev notiflib.Event) {
	if s.notif == nil {
		return
	}
	_ = s.notif.Publish(ctx, ev)
}

// deliverNotifications fans out the structured notifications resolved by the
// engine. The engine puts the recipient as a string; if it parses as a UUID we
// treat it as a user id, otherwise we fall back to the tenant id so the event
// is still recorded (notification-svc applies per-user channel preferences).
func (s *Service) deliverNotifications(ctx context.Context, tid uuid.UUID, inst *domain.WorkflowInstance, notifs []domain.RuntimeNotification) {
	for _, n := range notifs {
		userID := tid.String()
		if n.Recipient != nil && *n.Recipient != "" {
			userID = *n.Recipient
		}
		kind := n.Kind
		if kind == "" {
			kind = "workflow.notification"
		}
		title := n.Title
		if title == "" {
			title = "Workflow notification"
		}
		s.publish(ctx, notiflib.Event{
			TenantID: tid.String(),
			UserID:   userID,
			Kind:     kind,
			Title:    title,
			Body:     n.Message,
			Payload: map[string]any{
				"instance_id": inst.ID.String(),
				"step_id":     n.StepID,
				"channel":     n.Channel,
			},
		})
	}
}

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

	// Timer (wait step): if the engine paused with a wake duration, set wake_at
	// so the scheduler poller resumes us. Otherwise the pause is a human_task
	// (woken by task completion) — clear any stale timer.
	inst.WakeAt = nil
	if inst.Status == domain.InstancePaused && rr.WakeSeconds != nil {
		t := time.Now().Add(time.Duration(*rr.WakeSeconds) * time.Second)
		inst.WakeAt = &t
	}

	// Signature correlation: if the engine paused on a request_signature step it
	// returns pending_signature{step_id, envelope_id, document_id}. Persist the
	// envelope id so the document-svc signed/declined event can find and resume
	// this instance. Any other transition (resume / completion) clears it.
	inst.PendingEnvelopeID = nil
	if inst.Status == domain.InstancePaused && rr.PendingSignature != nil {
		if env, err := uuid.Parse(rr.PendingSignature.EnvelopeID); err == nil {
			inst.PendingEnvelopeID = &env
			// cursor is already set to rr.Cursor (the request_signature step id);
			// keep status paused awaiting the signature event.
		} else {
			log.Warn().Str("envelope_id", rr.PendingSignature.EnvelopeID).
				Str("instance_id", inst.ID.String()).
				Msg("pending_signature envelope_id is not a UUID — cannot correlate signature event")
		}
	}

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
		// SLA: engine returns the parsed duration in seconds; the deadline is
		// anchored at task creation time.
		if rht.SLASeconds != nil && *rht.SLASeconds > 0 {
			deadline := time.Now().Add(time.Duration(*rht.SLASeconds) * time.Second)
			ht.SLADeadline = &deadline
		}
		humanTasks = append(humanTasks, ht)
	}

	if err := s.Instances.UpdateStateAndSteps(ctx, tid, inst, steps, humanTasks); err != nil {
		return nil, fmt.Errorf("persist result: %w", err)
	}

	// ── Notification fan-out (engine never sends mail/webhooks itself) ──────
	s.deliverNotifications(ctx, tid, inst, rr.Notifications)

	// Tell each assignee a human task is waiting for them.
	for _, ht := range humanTasks {
		if ht.AssigneeID == nil {
			continue
		}
		s.publish(ctx, notiflib.Event{
			TenantID: tid.String(),
			UserID:   ht.AssigneeID.String(),
			Kind:     "workflow.human_task.assigned",
			Title:    "You have a workflow task",
			Body:     "A workflow step requires your action.",
			Payload: map[string]any{
				"instance_id":   inst.ID.String(),
				"human_task_id": ht.ID.String(),
				"step_id":       ht.StepID,
			},
		})
	}

	// Lifecycle notifications on terminal states.
	switch inst.Status {
	case domain.InstanceCompleted:
		s.publish(ctx, notiflib.Event{
			TenantID: tid.String(),
			UserID:   tid.String(), // best-effort: no actor in runtime response
			Kind:     "workflow.instance.completed",
			Title:    "Workflow instance completed",
			Payload:  map[string]any{"instance_id": inst.ID.String()},
		})
	case domain.InstanceFailed:
		body := ""
		if inst.Error != nil {
			body = *inst.Error
		}
		s.publish(ctx, notiflib.Event{
			TenantID: tid.String(),
			UserID:   tid.String(),
			Kind:     "workflow.instance.failed",
			Title:    "Workflow instance failed",
			Body:     body,
			Payload:  map[string]any{"instance_id": inst.ID.String()},
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
