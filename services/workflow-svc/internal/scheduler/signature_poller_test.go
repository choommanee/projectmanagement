package scheduler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/workflow-svc/internal/docsvc"
	"github.com/pmplatform/services/workflow-svc/internal/domain"
	"github.com/pmplatform/services/workflow-svc/internal/scheduler"
	"github.com/pmplatform/services/workflow-svc/internal/service"
	"github.com/pmplatform/services/workflow-svc/internal/store"
)

func openPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
	}
	p, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	if err := p.Ping(context.Background()); err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	return p
}

func seedTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
	t.Helper()
	tid := uuid.New()
	_, err := p.Exec(context.Background(),
		"INSERT INTO tenant(id, slug, name, tier, status, region) VALUES ($1,$2,$3,'shared','active','us')",
		tid, "wf-sig-"+tid.String()[:8], "WF Sig Tenant "+tid.String()[:8])
	if err != nil {
		t.Fatalf("seedTenant: %v", err)
	}
	t.Cleanup(func() {
		p.Exec(context.Background(), "DELETE FROM tenant WHERE id=$1", tid) //nolint:errcheck
	})
	return tid
}

// seedPausedSignatureInstance creates a definition+version+instance that is
// paused on a request_signature step, with pending_envelope_id set.
func seedPausedSignatureInstance(t *testing.T, p *pgxpool.Pool, tid, envelopeID uuid.UUID) (*service.Service, *store.Instances, uuid.UUID) {
	t.Helper()
	defs := store.NewDefinitions(p)
	vers := store.NewVersions(p)
	insts := store.NewInstances(p)

	d := &domain.WorkflowDefinition{
		ID: uuid.New(), TenantID: tid, Name: "Sig Poll Test",
		Status: domain.WorkflowPublished, CurrentVersion: 1, Version: 1,
	}
	if err := defs.Create(context.Background(), d); err != nil {
		t.Fatalf("create def: %v", err)
	}
	// A trivial DSL is sufficient — the runtime is stubbed by httptest, so the
	// resume path never actually interprets these steps.
	dsl, _ := json.Marshal(map[string]any{
		"id": "v1",
		"steps": []any{
			map[string]any{"id": "sign1", "type": "request_signature"},
		},
	})
	v := &domain.WorkflowVersion{
		ID: uuid.New(), TenantID: tid, DefinitionID: d.ID, Rev: 1, DSL: dsl,
	}
	if err := vers.Create(context.Background(), v); err != nil {
		t.Fatalf("create ver: %v", err)
	}

	inst := &domain.WorkflowInstance{
		ID:           uuid.New(),
		TenantID:     tid,
		DefinitionID: d.ID,
		VersionID:    v.ID,
		Status:       domain.InstanceRunning,
		Input:        json.RawMessage(`{}`),
		Variables:    json.RawMessage(`{}`),
		TriggerKind:  domain.TriggerManual,
	}
	if err := insts.Create(context.Background(), inst); err != nil {
		t.Fatalf("create inst: %v", err)
	}

	// Transition to paused on the signature step with a pending envelope.
	cursor := "sign1"
	inst.Status = domain.InstancePaused
	inst.Cursor = &cursor
	inst.PendingEnvelopeID = &envelopeID
	inst.Output = json.RawMessage(`null`)
	if err := insts.UpdateStateAndSteps(context.Background(), tid, inst, nil, nil); err != nil {
		t.Fatalf("pause inst: %v", err)
	}

	svc := service.New(defs, vers, insts, store.NewHumanTasks(p), "" /* runtime set below */)
	return svc, insts, inst.ID
}

// capturedRuntime is a workflow-runtime /execute stub that records the merged
// input it received, so the test can assert signature_outcome was injected on
// resume. (UpdateStateAndSteps does not persist the instance.input column, so
// the runtime call is the observable carrier of the outcome.)
type capturedRuntime struct {
	srv          *httptest.Server
	lastOutcomes []string
}

func runtimeStub(t *testing.T) *capturedRuntime {
	t.Helper()
	cr := &capturedRuntime{}
	cr.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req domain.RuntimeRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		var m map[string]any
		_ = json.Unmarshal(req.Input, &m)
		if oc, ok := m["signature_outcome"].(string); ok {
			cr.lastOutcomes = append(cr.lastOutcomes, oc)
		}
		resp := domain.RuntimeResponse{
			Status:    "completed",
			Variables: json.RawMessage(`{}`),
			Output:    req.Input,
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	t.Cleanup(cr.srv.Close)
	return cr
}

func (cr *capturedRuntime) sawOutcome(want string) bool {
	for _, o := range cr.lastOutcomes {
		if o == want {
			return true
		}
	}
	return false
}

// docStub returns an httptest server mimicking document-svc GET
// /v1/sign-envelopes/{id} with the given status.
func docStub(t *testing.T, status string) *docsvc.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Parse the trailing UUID from the path.
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":     uuid.New().String(),
			"status": status,
		})
	}))
	t.Cleanup(srv.Close)
	return docsvc.New(srv.URL)
}

func TestSignaturePoller_Completed_Resumes(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	envelopeID := uuid.New()

	rt := runtimeStub(t)
	svc, insts, instID := seedPausedSignatureInstance(t, p, tid, envelopeID)
	svc.RuntimeURL = rt.srv.URL
	doc := docStub(t, "completed")

	// RunOnce returns a global count (cross-tenant background job), so assert on
	// THIS instance's resulting state rather than the count.
	sp := scheduler.NewSignaturePoller(svc, insts, doc, nil, 0)
	sp.RunOnce(context.Background())

	got, err := insts.GetByID(context.Background(), tid, instID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Status == domain.InstancePaused {
		t.Errorf("expected instance no longer paused, got %s", got.Status)
	}
	if got.PendingEnvelopeID != nil {
		t.Errorf("expected pending_envelope_id cleared, got %s", got.PendingEnvelopeID)
	}
	if !rt.sawOutcome("signed") {
		t.Errorf("expected runtime resume to carry signature_outcome=signed, saw %v", rt.lastOutcomes)
	}
}

func TestSignaturePoller_Declined_Resumes(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	envelopeID := uuid.New()

	rt := runtimeStub(t)
	svc, insts, instID := seedPausedSignatureInstance(t, p, tid, envelopeID)
	svc.RuntimeURL = rt.srv.URL
	doc := docStub(t, "declined")

	sp := scheduler.NewSignaturePoller(svc, insts, doc, nil, 0)
	sp.RunOnce(context.Background())

	got, err := insts.GetByID(context.Background(), tid, instID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Status == domain.InstancePaused {
		t.Errorf("expected instance no longer paused, got %s", got.Status)
	}
	if got.PendingEnvelopeID != nil {
		t.Errorf("expected pending_envelope_id cleared, got %s", got.PendingEnvelopeID)
	}
	if !rt.sawOutcome("declined") {
		t.Errorf("expected runtime resume to carry signature_outcome=declined, saw %v", rt.lastOutcomes)
	}
}

func TestSignaturePoller_StillSent_StaysPaused(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	envelopeID := uuid.New()

	rt := runtimeStub(t)
	svc, insts, instID := seedPausedSignatureInstance(t, p, tid, envelopeID)
	svc.RuntimeURL = rt.srv.URL
	doc := docStub(t, "sent")

	sp := scheduler.NewSignaturePoller(svc, insts, doc, nil, 0)
	sp.RunOnce(context.Background())

	got, err := insts.GetByID(context.Background(), tid, instID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Status != domain.InstancePaused {
		t.Errorf("expected instance still paused, got %s", got.Status)
	}
	if got.PendingEnvelopeID == nil || *got.PendingEnvelopeID != envelopeID {
		t.Errorf("expected pending_envelope_id retained, got %v", got.PendingEnvelopeID)
	}
	if len(rt.lastOutcomes) != 0 {
		t.Errorf("expected no runtime resume for sent envelope, saw %v", rt.lastOutcomes)
	}
}

// TestSignaturePoller_404_Skips ensures a missing envelope is skipped (instance
// stays paused) rather than crashing or failing the instance.
func TestSignaturePoller_404_Skips(t *testing.T) {
	p := openPool(t)
	defer p.Close()
	tid := seedTenant(t, p)
	envelopeID := uuid.New()

	svc, insts, instID := seedPausedSignatureInstance(t, p, tid, envelopeID)
	svc.RuntimeURL = runtimeStub(t).srv.URL

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	t.Cleanup(srv.Close)
	doc := docsvc.New(srv.URL)

	sp := scheduler.NewSignaturePoller(svc, insts, doc, nil, 0)
	if resumed := sp.RunOnce(context.Background()); resumed != 0 {
		t.Fatalf("expected 0 resumed for 404 envelope, got %d", resumed)
	}

	got, err := insts.GetByID(context.Background(), tid, instID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Status != domain.InstancePaused {
		t.Errorf("expected instance still paused after 404, got %s", got.Status)
	}
}
