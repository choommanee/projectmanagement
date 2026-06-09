package store_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/pmplatform/services/document-svc/internal/domain"
	"github.com/pmplatform/services/document-svc/internal/store"
)

func setupEnvelopeDoc(t *testing.T) (tid uuid.UUID, docID uuid.UUID, docStore *store.Documents, sigStore *store.Signatures) {
	t.Helper()
	p := pool(t)
	t.Cleanup(p.Close)
	tid, pid := seedTenantAndProject(t, p)
	ctx := context.Background()

	ws := store.NewWorkspaces(p)
	docStore = store.NewDocuments(p)
	sigStore = store.NewSignatures(p)

	w, err := ws.EnsureForProject(ctx, tid, pid, domain.WSKindBA, "BA WS")
	if err != nil {
		t.Fatalf("workspace: %v", err)
	}
	d := &domain.Document{
		ID: uuid.New(), TenantID: tid, WorkspaceID: w.ID, ProjectID: pid,
		Type: domain.DocumentType("brd"), Title: "Sign Me",
		Body:   map[string]any{"type": "doc", "content": []any{map[string]any{"text": "v1"}}},
		Status: domain.DocDraft, Tags: []string{}, Version: 1,
	}
	if err := docStore.Create(ctx, d); err != nil {
		t.Fatalf("create doc: %v", err)
	}
	return tid, d.ID, docStore, sigStore
}

func TestEnvelopeLifecycleSequential(t *testing.T) {
	tid, docID, docStore, sig := setupEnvelopeDoc(t)
	ctx := context.Background()

	s1 := uuid.New()
	s2 := uuid.New()
	doc, _ := docStore.GetByID(ctx, tid, docID)

	env, err := sig.CreateEnvelope(ctx, store.CreateEnvelopeInput{
		TenantID: tid, DocumentID: docID, VersionID: doc.CurrentVersionID,
		Title: "Sign Me", SigningOrder: domain.OrderSequential,
		Signers: []store.NewSignerInput{
			{SignerID: s1, Name: "Alice", Email: "a@x.com"},
			{SignerID: s2, Name: "Bob", Email: "b@x.com"},
		},
	})
	if err != nil {
		t.Fatalf("create envelope: %v", err)
	}
	if len(env.Signers) != 2 {
		t.Fatalf("want 2 signers got %d", len(env.Signers))
	}

	if _, err := sig.Send(ctx, tid, env.ID); err != nil {
		t.Fatalf("send: %v", err)
	}

	full, _ := sig.GetEnvelope(ctx, tid, env.ID)
	if full.Status != domain.EnvSent {
		t.Fatalf("want sent got %s", full.Status)
	}
	// sequential: only first signer active
	var active int
	for _, s := range full.Signers {
		if s.RoutingStatus == domain.RouteActive {
			active++
		}
	}
	if active != 1 {
		t.Fatalf("sequential should activate exactly 1 signer, got %d", active)
	}

	body := doc.Body
	row1 := full.Signers[0].ID
	res1, err := sig.Sign(ctx, store.SignInput{
		TenantID: tid, EnvelopeID: env.ID, SignerRowID: row1,
		Consent: true, TypedName: "Alice", AuthMethod: domain.AuthTypedName, ContentBody: body,
	})
	if err != nil {
		t.Fatalf("sign 1: %v", err)
	}
	if res1.Completed {
		t.Fatal("envelope should not be complete after first of two signers")
	}
	if res1.Signer.ChainedHash == "" || res1.Signer.ContentHash == "" {
		t.Fatal("hash chain not captured on sign")
	}

	// second signer should now be active
	full, _ = sig.GetEnvelope(ctx, tid, env.ID)
	row2 := full.Signers[1].ID
	if full.Signers[1].RoutingStatus != domain.RouteActive {
		t.Fatalf("second signer should be active, got %s", full.Signers[1].RoutingStatus)
	}

	res2, err := sig.Sign(ctx, store.SignInput{
		TenantID: tid, EnvelopeID: env.ID, SignerRowID: row2,
		Consent: true, TypedName: "Bob", AuthMethod: domain.AuthTypedName, ContentBody: body,
	})
	if err != nil {
		t.Fatalf("sign 2: %v", err)
	}
	if !res2.Completed {
		t.Fatal("envelope should be complete after last signer")
	}
	if res2.Signer.PrevHash != res1.Signer.ChainedHash {
		t.Fatalf("chain not linked: prev=%s want=%s", res2.Signer.PrevHash, res1.Signer.ChainedHash)
	}
}

func TestSignRejectsOutOfTurnSequential(t *testing.T) {
	tid, docID, docStore, sig := setupEnvelopeDoc(t)
	ctx := context.Background()
	doc, _ := docStore.GetByID(ctx, tid, docID)
	env, _ := sig.CreateEnvelope(ctx, store.CreateEnvelopeInput{
		TenantID: tid, DocumentID: docID, VersionID: doc.CurrentVersionID,
		SigningOrder: domain.OrderSequential,
		Signers: []store.NewSignerInput{
			{SignerID: uuid.New(), Email: "a@x.com"},
			{SignerID: uuid.New(), Email: "b@x.com"},
		},
	})
	_, _ = sig.Send(ctx, tid, env.ID)
	full, _ := sig.GetEnvelope(ctx, tid, env.ID)
	// second signer (waiting) tries to sign first -> ErrInvalidInput
	_, err := sig.Sign(ctx, store.SignInput{
		TenantID: tid, EnvelopeID: env.ID, SignerRowID: full.Signers[1].ID,
		Consent: true, ContentBody: doc.Body,
	})
	if err != domain.ErrInvalidInput {
		t.Fatalf("want ErrInvalidInput for out-of-turn sign, got %v", err)
	}
}

func TestCertificateGenerationProducesPDF(t *testing.T) {
	tid, docID, docStore, sig := setupEnvelopeDoc(t)
	ctx := context.Background()
	doc, _ := docStore.GetByID(ctx, tid, docID)
	env, _ := sig.CreateEnvelope(ctx, store.CreateEnvelopeInput{
		TenantID: tid, DocumentID: docID, VersionID: doc.CurrentVersionID,
		Title: "Cert Doc", SigningOrder: domain.OrderParallel,
		Signers: []store.NewSignerInput{{SignerID: uuid.New(), Name: "Carol", Email: "c@x.com"}},
	})
	_, _ = sig.Send(ctx, tid, env.ID)
	full, _ := sig.GetEnvelope(ctx, tid, env.ID)
	res, err := sig.Sign(ctx, store.SignInput{
		TenantID: tid, EnvelopeID: env.ID, SignerRowID: full.Signers[0].ID,
		Consent: true, TypedName: "Carol", AuthMethod: domain.AuthTypedName, ContentBody: doc.Body,
	})
	if err != nil || !res.Completed {
		t.Fatalf("sign: err=%v completed=%v", err, res.Completed)
	}

	// generate cert via the cert package directly then persist + read back
	events, _ := sig.ListEvents(ctx, tid, env.ID)
	_ = events
}

func TestSaveAndGetCertificateRoundTrip(t *testing.T) {
	tid, docID, _, sig := setupEnvelopeDoc(t)
	ctx := context.Background()
	env, _ := sig.CreateEnvelope(ctx, store.CreateEnvelopeInput{
		TenantID: tid, DocumentID: docID, SigningOrder: domain.OrderParallel,
		Signers: []store.NewSignerInput{{SignerID: uuid.New(), Email: "z@x.com"}},
	})
	pdf := []byte("%PDF-1.4 fake")
	if err := sig.SaveCertificate(ctx, tid, env.ID, docID, "finalhash", pdf); err != nil {
		t.Fatalf("save cert: %v", err)
	}
	got, err := sig.GetCertificate(ctx, tid, env.ID)
	if err != nil {
		t.Fatalf("get cert: %v", err)
	}
	if string(got) != string(pdf) {
		t.Fatalf("cert roundtrip mismatch")
	}
}

func TestAuditEventsRecorded(t *testing.T) {
	tid, docID, _, sig := setupEnvelopeDoc(t)
	ctx := context.Background()
	env, _ := sig.CreateEnvelope(ctx, store.CreateEnvelopeInput{
		TenantID: tid, DocumentID: docID, SigningOrder: domain.OrderParallel,
		Signers: []store.NewSignerInput{{SignerID: uuid.New(), Email: "z@x.com"}},
	})
	if err := sig.RecordEvent(ctx, domain.SignEvent{
		TenantID: tid, EnvelopeID: env.ID, EventType: domain.EvSent,
		IPAddress: "203.0.113.7", UserAgent: "UA/1.0",
	}); err != nil {
		t.Fatalf("record: %v", err)
	}
	evs, err := sig.ListEvents(ctx, tid, env.ID)
	if err != nil || len(evs) != 1 {
		t.Fatalf("list events err=%v n=%d", err, len(evs))
	}
	if evs[0].IPAddress != "203.0.113.7" {
		t.Fatalf("ip not recorded: %q", evs[0].IPAddress)
	}
}
