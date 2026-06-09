package service_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/workflow-svc/internal/domain"
	"github.com/pmplatform/services/workflow-svc/internal/service"
	"github.com/pmplatform/services/workflow-svc/internal/store"
)

// recordedReq captures the decoded body of one /execute call so tests can
// assert what workflow-svc forwarded to the runtime (auth_token, tenant_id,
// resume_inclusive, etc.).
type recordedReq struct {
	AuthToken        *string         `json:"auth_token"`
	TenantID         *string         `json:"tenant_id"`
	ResumeInclusive  *bool           `json:"resume_inclusive"`
	ResumeFromStepID *string         `json:"resume_from_step_id"`
	Input            json.RawMessage `json:"input"`
}

// recordingRuntime serves a sequence of canned ExecuteOutput responses while
// recording every inbound /execute request body.
type recordingRuntime struct {
	mu     sync.Mutex
	calls  []recordedReq
	stages []map[string]any
}

func (rt *recordingRuntime) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var rec recordedReq
		_ = json.Unmarshal(body, &rec)
		rt.mu.Lock()
		idx := len(rt.calls)
		rt.calls = append(rt.calls, rec)
		if idx >= len(rt.stages) {
			idx = len(rt.stages) - 1
		}
		stage := rt.stages[idx]
		rt.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(stage)
	}
}

func (rt *recordingRuntime) call(i int) recordedReq {
	rt.mu.Lock()
	defer rt.mu.Unlock()
	return rt.calls[i]
}

// stubMinter implements the (private) tokenMinter the service consumes. We
// can't reference the interface from outside the package, but WithServiceAuth
// accepts any type with TokenFor — Go structural-types it at the call site via
// the exported method set, so this concrete type works.
type stubMinter struct{ token string }

func (m stubMinter) TokenFor(_ context.Context, _ string) (string, error) {
	return m.token, nil
}

// TestApprovalLoop_ApprovedSigned drives the full happy path:
// start → paused at human_task → complete "approved" → engine returns
// pending_signature (paused, pending_envelope_id set) → simulate
// document.sign_completed → resume → completed status "approved_signed".
func TestApprovalLoop_ApprovedSigned(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)
	d, _ := setupDefAndVersion(t, pool, tid)

	approver := uuid.New()
	envelopeID := uuid.New()

	rt := &recordingRuntime{stages: []map[string]any{
		{ // call 0: start → paused at human_task "review"
			"status": "paused", "variables": map[string]any{}, "output": nil,
			"cursor": "review", "error": nil,
			"steps": []any{map[string]any{"step_id": "review", "step_type": "human_task", "status": "running",
				"input": map[string]any{}, "output": map[string]any{}, "error": nil, "duration_ms": 0}},
			"human_tasks": []any{map[string]any{"step_id": "review", "assignee": approver.String(),
				"form": map[string]any{"prompt": "Approve?", "outcomes": []any{"approved", "rejected"}, "fields": []any{}}}},
			"notifications": []any{}, "wake_seconds": nil, "pending_signature": nil,
		},
		{ // call 1: resume after approve → paused awaiting signature
			"status": "paused", "variables": map[string]any{}, "output": nil,
			"cursor": "get_sig", "error": nil,
			"steps": []any{map[string]any{"step_id": "get_sig", "step_type": "request_signature", "status": "running",
				"input": map[string]any{}, "output": map[string]any{}, "error": nil, "duration_ms": 1}},
			"human_tasks": []any{}, "notifications": []any{}, "wake_seconds": nil,
			"pending_signature": map[string]any{
				"step_id": "get_sig", "envelope_id": envelopeID.String(), "document_id": uuid.New().String()},
		},
		{ // call 2: resume after sign_completed → completed approved_signed
			"status": "completed", "variables": map[string]any{},
			"output": map[string]any{"status": "approved_signed"},
			"cursor": nil, "error": nil,
			"steps": []any{map[string]any{"step_id": "end_ok", "step_type": "end", "status": "completed",
				"input": map[string]any{}, "output": map[string]any{"status": "approved_signed"}, "error": nil, "duration_ms": 0}},
			"human_tasks": []any{}, "notifications": []any{}, "wake_seconds": nil, "pending_signature": nil,
		},
	}}
	rtSrv := httptest.NewServer(rt.handler())
	defer rtSrv.Close()

	svc := newSvc(pool, rtSrv.URL, nil).WithServiceAuth(stubMinter{token: "svc-tok-123"})

	// Start → paused at human_task.
	res, err := svc.StartInstance(context.Background(), service.StartInstanceInput{
		TenantID: tid, DefinitionID: d.ID,
		Input: json.RawMessage(`{"approver_id":"` + approver.String() + `","document_id":"` + uuid.New().String() + `","requester_id":"` + uuid.New().String() + `"}`),
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if res.Instance.Status != domain.InstancePaused || len(res.HumanTasks) != 1 {
		t.Fatalf("expected paused with 1 human task, got %s / %d tasks", res.Instance.Status, len(res.HumanTasks))
	}

	// Complete the human task with "approved" → engine pauses awaiting signature.
	res2, err := svc.CompleteHumanTask(context.Background(), tid, res.HumanTasks[0].ID, "approved", json.RawMessage(`{"note":"lgtm"}`))
	if err != nil {
		t.Fatalf("complete approved: %v", err)
	}
	if res2.Instance.Status != domain.InstancePaused {
		t.Fatalf("expected paused awaiting signature, got %s", res2.Instance.Status)
	}
	if res2.Instance.PendingEnvelopeID == nil || *res2.Instance.PendingEnvelopeID != envelopeID {
		t.Fatalf("expected pending_envelope_id=%s, got %v", envelopeID, res2.Instance.PendingEnvelopeID)
	}

	// Assert the human-task outcome was injected into the resume input.
	c1 := rt.call(1)
	var in1 map[string]any
	_ = json.Unmarshal(c1.Input, &in1)
	if in1["last_outcome"] != "approved" {
		t.Errorf("expected input.last_outcome=approved on resume, got %v", in1["last_outcome"])
	}
	if in1["review_outcome"] != "approved" {
		t.Errorf("expected input.review_outcome=approved, got %v", in1["review_outcome"])
	}
	if in1["note"] != "lgtm" {
		t.Errorf("expected merged form field note=lgtm, got %v", in1["note"])
	}

	// Simulate document.sign_completed for the envelope → instance resumes.
	res3, err := svc.ResumeBySignature(context.Background(), tid, envelopeID, "signed")
	if err != nil {
		t.Fatalf("resume by signature: %v", err)
	}
	if res3 == nil {
		t.Fatalf("expected a result from ResumeBySignature, got nil (instance not found?)")
	}
	if res3.Instance.Status != domain.InstanceCompleted {
		t.Fatalf("expected completed after signature, got %s", res3.Instance.Status)
	}
	if res3.Instance.PendingEnvelopeID != nil {
		t.Errorf("expected pending_envelope_id cleared after resume, got %v", res3.Instance.PendingEnvelopeID)
	}
	var out map[string]any
	_ = json.Unmarshal(res3.Instance.Output, &out)
	if out["status"] != "approved_signed" {
		t.Errorf("expected output status approved_signed, got %v", out)
	}

	// Assert signature_outcome was injected on the signature resume (call 2).
	c2 := rt.call(2)
	var in2 map[string]any
	_ = json.Unmarshal(c2.Input, &in2)
	if in2["signature_outcome"] != "signed" {
		t.Errorf("expected input.signature_outcome=signed, got %v", in2["signature_outcome"])
	}

	// Assert serviceauth forwarded token + tenant on every /execute call.
	for i := 0; i < 3; i++ {
		c := rt.call(i)
		if c.AuthToken == nil || *c.AuthToken != "svc-tok-123" {
			t.Errorf("call %d: expected auth_token=svc-tok-123, got %v", i, c.AuthToken)
		}
		if c.TenantID == nil || *c.TenantID != tid.String() {
			t.Errorf("call %d: expected tenant_id=%s, got %v", i, tid, c.TenantID)
		}
	}
	// Human-task / signature resumes must be inclusive (skip the paused step).
	if c1.ResumeInclusive == nil || *c1.ResumeInclusive != true {
		t.Errorf("human-task resume must be resume_inclusive=true, got %v", c1.ResumeInclusive)
	}
}

// TestApprovalLoop_Rejected verifies the rejected branch completes without ever
// pausing for a signature and never sets pending_envelope_id.
func TestApprovalLoop_Rejected(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)
	d, _ := setupDefAndVersion(t, pool, tid)

	approver := uuid.New()

	rt := &recordingRuntime{stages: []map[string]any{
		{ // start → paused at human_task
			"status": "paused", "variables": map[string]any{}, "output": nil,
			"cursor": "review", "error": nil,
			"steps": []any{map[string]any{"step_id": "review", "step_type": "human_task", "status": "running",
				"input": map[string]any{}, "output": map[string]any{}, "error": nil, "duration_ms": 0}},
			"human_tasks": []any{map[string]any{"step_id": "review", "assignee": approver.String(),
				"form": map[string]any{"prompt": "Approve?", "fields": []any{}}}},
			"notifications": []any{}, "wake_seconds": nil, "pending_signature": nil,
		},
		{ // resume after reject → completed rejected, no pending_signature
			"status": "completed", "variables": map[string]any{},
			"output": map[string]any{"status": "rejected"},
			"cursor": nil, "error": nil,
			"steps": []any{map[string]any{"step_id": "end_rej", "step_type": "end", "status": "completed",
				"input": map[string]any{}, "output": map[string]any{"status": "rejected"}, "error": nil, "duration_ms": 0}},
			"human_tasks": []any{}, "notifications": []any{}, "wake_seconds": nil, "pending_signature": nil,
		},
	}}
	rtSrv := httptest.NewServer(rt.handler())
	defer rtSrv.Close()

	svc := newSvc(pool, rtSrv.URL, nil).WithServiceAuth(stubMinter{token: "t"})

	res, err := svc.StartInstance(context.Background(), service.StartInstanceInput{
		TenantID: tid, DefinitionID: d.ID, Input: json.RawMessage(`{"approver_id":"` + approver.String() + `"}`),
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}

	res2, err := svc.CompleteHumanTask(context.Background(), tid, res.HumanTasks[0].ID, "rejected", nil)
	if err != nil {
		t.Fatalf("complete rejected: %v", err)
	}
	if res2.Instance.Status != domain.InstanceCompleted {
		t.Fatalf("expected completed, got %s", res2.Instance.Status)
	}
	if res2.Instance.PendingEnvelopeID != nil {
		t.Errorf("rejected path must not set pending_envelope_id, got %v", res2.Instance.PendingEnvelopeID)
	}
	var out map[string]any
	_ = json.Unmarshal(res2.Instance.Output, &out)
	if out["status"] != "rejected" {
		t.Errorf("expected output status rejected, got %v", out)
	}

	// Outcome injection on the reject resume.
	c1 := rt.call(1)
	var in1 map[string]any
	_ = json.Unmarshal(c1.Input, &in1)
	if in1["last_outcome"] != "rejected" {
		t.Errorf("expected input.last_outcome=rejected, got %v", in1["last_outcome"])
	}
}

// TestRetryReRunsFailedStep proves retry uses resume_inclusive=false so the
// failed cursor step is RE-EXECUTED (not skipped). The runtime fails the same
// step again, so the instance stays failed — distinct from a human_task resume
// which skips the paused step.
func TestRetryReRunsFailedStep(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)
	d, _ := setupDefAndVersion(t, pool, tid)

	failStage := map[string]any{
		"status": "failed", "variables": map[string]any{}, "output": nil,
		"cursor": "callout", "error": "http request failed: connection refused",
		"steps": []any{map[string]any{"step_id": "callout", "step_type": "http", "status": "failed",
			"input": map[string]any{}, "output": nil, "error": "connection refused", "duration_ms": 5}},
		"human_tasks": []any{}, "notifications": []any{}, "wake_seconds": nil, "pending_signature": nil,
	}
	rt := &recordingRuntime{stages: []map[string]any{failStage, failStage}} // fails both times
	rtSrv := httptest.NewServer(rt.handler())
	defer rtSrv.Close()

	svc := newSvc(pool, rtSrv.URL, nil)

	res, err := svc.StartInstance(context.Background(), service.StartInstanceInput{
		TenantID: tid, DefinitionID: d.ID, Input: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatalf("start: %v", err)
	}
	if res.Instance.Status != domain.InstanceFailed {
		t.Fatalf("expected failed, got %s", res.Instance.Status)
	}

	res2, err := svc.RetryInstance(context.Background(), tid, res.Instance.ID)
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if res2.Instance.Status != domain.InstanceFailed {
		t.Fatalf("retry must re-run the failed step (stays failed against unreachable URL), got %s", res2.Instance.Status)
	}

	// The retry call (index 1) must carry resume_inclusive=false targeting the
	// failed cursor step.
	c1 := rt.call(1)
	if c1.ResumeInclusive == nil || *c1.ResumeInclusive != false {
		t.Errorf("retry must send resume_inclusive=false, got %v", c1.ResumeInclusive)
	}
	if c1.ResumeFromStepID == nil || *c1.ResumeFromStepID != "callout" {
		t.Errorf("retry must resume from the failed cursor 'callout', got %v", c1.ResumeFromStepID)
	}
}

// TestResumeBySignature_NoMatch is a no-op (and no error) when no instance is
// awaiting the envelope — events may target envelopes this service did not
// originate.
func TestResumeBySignature_NoMatch(t *testing.T) {
	pool := openPool(t)
	defer pool.Close()
	tid := seedTenant(t, pool)

	svc := newSvc(pool, "http://localhost:1", nil) // runtime never called
	res, err := svc.ResumeBySignature(context.Background(), tid, uuid.New(), "signed")
	if err != nil {
		t.Fatalf("expected nil error for no-match, got %v", err)
	}
	if res != nil {
		t.Fatalf("expected nil result for no-match, got %+v", res)
	}
}

// ensure store import retained for symmetry with other test files.
var _ = store.NewInstances
