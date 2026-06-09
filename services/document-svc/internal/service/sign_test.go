package service_test

import (
	"bytes"
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/document-svc/internal/domain"
	"github.com/pmplatform/services/document-svc/internal/service"
	"github.com/pmplatform/services/document-svc/internal/store"
)

func pool(t *testing.T) *pgxpool.Pool {
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
		p.Close()
		t.Skipf("postgres ping failed: %v", err)
	}
	return p
}

func seedTenantProject(t *testing.T, p *pgxpool.Pool) (uuid.UUID, uuid.UUID) {
	t.Helper()
	tid := uuid.New()
	pid := uuid.New()
	ctx := context.Background()
	if _, err := p.Exec(ctx,
		"INSERT INTO tenant(id, slug, name, tier, status, region) VALUES ($1,$2,$3,'shared','active','us')",
		tid, "svc-"+tid.String()[:8], "Svc Test"); err != nil {
		t.Fatalf("seed tenant: %v", err)
	}
	if _, err := p.Exec(ctx,
		"INSERT INTO project(id, tenant_id, code, name, status, version) VALUES ($1,$2,$3,$4,'planning',1)",
		pid, tid, "SV-"+pid.String()[:4], "Svc Project"); err != nil {
		t.Fatalf("seed project: %v", err)
	}
	t.Cleanup(func() { p.Exec(ctx, "DELETE FROM tenant WHERE id=$1", tid) })
	return tid, pid
}

func newSvc(p *pgxpool.Pool) *service.Service {
	return service.New(
		store.NewWorkspaces(p), store.NewDocuments(p), store.NewComments(p), store.NewTemplates(p),
	).WithSignatures(store.NewSignatures(p))
}

func TestSignFlowGeneratesCertificateAndVerifies(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, pid := seedTenantProject(t, p)
	ctx := context.Background()
	svc := newSvc(p)

	ws, err := svc.Workspaces.EnsureForProject(ctx, tid, pid, domain.WSKindBA, "WS")
	if err != nil {
		t.Fatalf("ws: %v", err)
	}
	doc, err := svc.CreateDocument(ctx, service.CreateDocumentInput{
		TenantID: tid, WorkspaceID: ws.ID, ProjectID: pid,
		Type: domain.DocumentType("brd"), Title: "Contract",
		Body: map[string]any{"type": "doc", "content": []any{map[string]any{"text": "agreement"}}},
	})
	if err != nil {
		t.Fatalf("doc: %v", err)
	}

	dana := uuid.New()
	env, err := svc.CreateEnvelope(ctx, service.CreateEnvelopeInput{
		TenantID: tid, DocumentID: doc.ID, SigningOrder: domain.OrderParallel,
		Signers: []store.NewSignerInput{{SignerID: dana, Name: "Dana", Email: "d@x.com"}},
	})
	if err != nil {
		t.Fatalf("envelope: %v", err)
	}

	am := service.AuditMeta{IPAddress: "198.51.100.4", UserAgent: "Mozilla/5.0", ActorID: &dana}
	if _, err := svc.SendEnvelope(ctx, tid, env.ID, am); err != nil {
		t.Fatalf("send: %v", err)
	}

	full, _ := svc.Signatures.GetEnvelope(ctx, tid, env.ID)
	res, err := svc.SignEnvelopeSigner(ctx, service.SignInput{
		TenantID: tid, EnvelopeID: env.ID, SignerRowID: full.Signers[0].ID,
		Consent: true, TypedName: "Dana", AuthMethod: domain.AuthTypedName,
	}, am)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if !res.Completed {
		t.Fatal("should be completed")
	}

	// Certificate must be a non-empty PDF.
	pdf, err := svc.GetCertificate(ctx, tid, env.ID)
	if err != nil {
		t.Fatalf("cert: %v", err)
	}
	if len(pdf) == 0 {
		t.Fatal("certificate PDF is empty")
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF")) {
		t.Fatalf("certificate is not a PDF: %q", pdf[:min(8, len(pdf))])
	}

	// Chain must verify against unchanged content.
	vr, err := svc.VerifyChain(ctx, tid, env.ID)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !vr.Valid {
		t.Fatalf("chain should be valid: %+v", vr)
	}

	// Audit trail must contain consent + signed + completed events with IP.
	evs, _ := svc.Signatures.ListEvents(ctx, tid, env.ID)
	var sawSigned, sawConsent, sawIP bool
	for _, e := range evs {
		if e.EventType == domain.EvSigned {
			sawSigned = true
		}
		if e.EventType == domain.EvConsented {
			sawConsent = true
		}
		if e.IPAddress == "198.51.100.4" {
			sawIP = true
		}
	}
	if !sawSigned || !sawConsent || !sawIP {
		t.Fatalf("audit incomplete: signed=%v consent=%v ip=%v", sawSigned, sawConsent, sawIP)
	}
}

func TestVerifyChainDetectsTamper(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, pid := seedTenantProject(t, p)
	ctx := context.Background()
	svc := newSvc(p)

	ws, _ := svc.Workspaces.EnsureForProject(ctx, tid, pid, domain.WSKindBA, "WS")
	doc, _ := svc.CreateDocument(ctx, service.CreateDocumentInput{
		TenantID: tid, WorkspaceID: ws.ID, ProjectID: pid,
		Type: domain.DocumentType("brd"), Title: "Tamper",
		Body: map[string]any{"type": "doc", "content": []any{"original"}},
	})
	signerE := uuid.New()
	env, _ := svc.CreateEnvelope(ctx, service.CreateEnvelopeInput{
		TenantID: tid, DocumentID: doc.ID, SigningOrder: domain.OrderParallel,
		Signers: []store.NewSignerInput{{SignerID: signerE, Email: "e@x.com"}},
	})
	_, _ = svc.SendEnvelope(ctx, tid, env.ID, service.AuditMeta{})
	full, _ := svc.Signatures.GetEnvelope(ctx, tid, env.ID)
	_, err := svc.SignEnvelopeSigner(ctx, service.SignInput{
		TenantID: tid, EnvelopeID: env.ID, SignerRowID: full.Signers[0].ID, Consent: true,
	}, service.AuditMeta{ActorID: &signerE})
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	// Tamper: edit the document body AFTER signing. The envelope is bound to
	// the original version, so verification should still pass (version is
	// immutable). To prove tamper detection we corrupt the stored content_hash.
	if _, err := p.Exec(ctx,
		"UPDATE document_signature SET content_hash='deadbeef' WHERE envelope_id=$1", env.ID); err != nil {
		t.Fatalf("tamper: %v", err)
	}
	vr, err := svc.VerifyChain(ctx, tid, env.ID)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if vr.Valid {
		t.Fatal("chain should be INVALID after content_hash tamper")
	}
}

func TestSignRequiresConsent(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, pid := seedTenantProject(t, p)
	ctx := context.Background()
	svc := newSvc(p)
	ws, _ := svc.Workspaces.EnsureForProject(ctx, tid, pid, domain.WSKindBA, "WS")
	doc, _ := svc.CreateDocument(ctx, service.CreateDocumentInput{
		TenantID: tid, WorkspaceID: ws.ID, ProjectID: pid,
		Type: domain.DocumentType("brd"), Title: "Consent",
	})
	env, _ := svc.CreateEnvelope(ctx, service.CreateEnvelopeInput{
		TenantID: tid, DocumentID: doc.ID, SigningOrder: domain.OrderParallel,
		Signers: []store.NewSignerInput{{SignerID: uuid.New(), Email: "f@x.com"}},
	})
	_, _ = svc.SendEnvelope(ctx, tid, env.ID, service.AuditMeta{})
	full, _ := svc.Signatures.GetEnvelope(ctx, tid, env.ID)
	_, err := svc.SignEnvelopeSigner(ctx, service.SignInput{
		TenantID: tid, EnvelopeID: env.ID, SignerRowID: full.Signers[0].ID, Consent: false,
	}, service.AuditMeta{})
	if err != domain.ErrInvalidInput {
		t.Fatalf("want ErrInvalidInput without consent, got %v", err)
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// TestSignerIdentityEnforced: the JWT actor must match the signer row's
// signer_id — signer B's identity cannot sign or decline signer A's row.
func TestSignerIdentityEnforced(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, pid := seedTenantProject(t, p)
	ctx := context.Background()
	svc := newSvc(p)

	ws, _ := svc.Workspaces.EnsureForProject(ctx, tid, pid, domain.WSKindBA, "WS")
	doc, _ := svc.CreateDocument(ctx, service.CreateDocumentInput{
		TenantID: tid, WorkspaceID: ws.ID, ProjectID: pid,
		Type: domain.DocumentType("brd"), Title: "Identity",
	})
	signerA := uuid.New()
	signerB := uuid.New()
	env, err := svc.CreateEnvelope(ctx, service.CreateEnvelopeInput{
		TenantID: tid, DocumentID: doc.ID, SigningOrder: domain.OrderParallel,
		Signers: []store.NewSignerInput{
			{SignerID: signerA, Name: "A", Email: "a@x.com"},
			{SignerID: signerB, Name: "B", Email: "b@x.com"},
		},
	})
	if err != nil {
		t.Fatalf("envelope: %v", err)
	}
	if _, err := svc.SendEnvelope(ctx, tid, env.ID, service.AuditMeta{}); err != nil {
		t.Fatalf("send: %v", err)
	}
	full, _ := svc.Signatures.GetEnvelope(ctx, tid, env.ID)
	rowA := full.Signers[0].ID

	// H1 regression: a principal with NO concrete user-UUID identity (nil
	// ActorID — e.g. a service token whose JWT subject is "svc:<service>" and
	// does not parse as a UUID) must FAIL CLOSED, never sign anyone's row.
	_, err = svc.SignEnvelopeSigner(ctx, service.SignInput{
		TenantID: tid, EnvelopeID: env.ID, SignerRowID: rowA, Consent: true,
	}, service.AuditMeta{ActorID: nil})
	if err != domain.ErrForbidden {
		t.Fatalf("service-token (nil actor) sign: want ErrForbidden, got %v", err)
	}
	// Same fail-closed posture for decline and OTP-request mutation paths.
	_, _, err = svc.DeclineEnvelopeSigner(ctx, tid, env.ID, rowA, "nope", service.AuditMeta{ActorID: nil})
	if err != domain.ErrForbidden {
		t.Fatalf("service-token (nil actor) decline: want ErrForbidden, got %v", err)
	}

	// B's actor tries to sign A's row → 403 / ErrForbidden.
	_, err = svc.SignEnvelopeSigner(ctx, service.SignInput{
		TenantID: tid, EnvelopeID: env.ID, SignerRowID: rowA, Consent: true,
	}, service.AuditMeta{ActorID: &signerB})
	if err != domain.ErrForbidden {
		t.Fatalf("cross-sign: want ErrForbidden, got %v", err)
	}

	// B's actor tries to decline A's row → ErrForbidden.
	_, _, err = svc.DeclineEnvelopeSigner(ctx, tid, env.ID, rowA, "nope", service.AuditMeta{ActorID: &signerB})
	if err != domain.ErrForbidden {
		t.Fatalf("cross-decline: want ErrForbidden, got %v", err)
	}

	// B's actor tries to view A's row → ErrForbidden.
	_, err = svc.ViewEnvelopeSigner(ctx, tid, env.ID, rowA, service.AuditMeta{ActorID: &signerB})
	if err != domain.ErrForbidden {
		t.Fatalf("cross-view: want ErrForbidden, got %v", err)
	}

	// A's own actor signs A's row → OK.
	if _, err := svc.SignEnvelopeSigner(ctx, service.SignInput{
		TenantID: tid, EnvelopeID: env.ID, SignerRowID: rowA, Consent: true,
	}, service.AuditMeta{ActorID: &signerA}); err != nil {
		t.Fatalf("self-sign should succeed: %v", err)
	}
}

// TestEventChainAndRecordSigVerify: fresh envelopes verify with
// event_chain=valid + record_sig_valid=true, document flips to approved on
// completion, and tampering an audit event row flips the chain to invalid.
func TestEventChainAndRecordSigVerify(t *testing.T) {
	p := pool(t)
	defer p.Close()
	tid, pid := seedTenantProject(t, p)
	ctx := context.Background()
	svc := newSvc(p)

	ws, _ := svc.Workspaces.EnsureForProject(ctx, tid, pid, domain.WSKindBA, "WS")
	doc, _ := svc.CreateDocument(ctx, service.CreateDocumentInput{
		TenantID: tid, WorkspaceID: ws.ID, ProjectID: pid,
		Type: domain.DocumentType("brd"), Title: "EventChain",
		Body: map[string]any{"type": "doc", "content": []any{"x"}},
	})
	signer := uuid.New()
	env, _ := svc.CreateEnvelope(ctx, service.CreateEnvelopeInput{
		TenantID: tid, DocumentID: doc.ID, SigningOrder: domain.OrderParallel,
		Signers: []store.NewSignerInput{{SignerID: signer, Email: "s@x.com"}},
	})
	_, _ = svc.SendEnvelope(ctx, tid, env.ID, service.AuditMeta{IPAddress: "192.0.2.1"})
	full, _ := svc.Signatures.GetEnvelope(ctx, tid, env.ID)
	res, err := svc.SignEnvelopeSigner(ctx, service.SignInput{
		TenantID: tid, EnvelopeID: env.ID, SignerRowID: full.Signers[0].ID, Consent: true,
	}, service.AuditMeta{ActorID: &signer, IPAddress: "192.0.2.1"})
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if !res.Completed {
		t.Fatal("expected completed")
	}

	// Document status reflects completion.
	d, err := svc.Documents.GetByID(ctx, tid, doc.ID)
	if err != nil {
		t.Fatalf("get doc: %v", err)
	}
	if d.Status != domain.DocApproved {
		t.Fatalf("doc status after completion: want approved, got %s", d.Status)
	}

	vr, err := svc.VerifyChain(ctx, tid, env.ID)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !vr.Valid {
		t.Fatalf("expected valid, got %+v", vr)
	}
	if vr.EventChain != domain.EventChainValid {
		t.Fatalf("event_chain: want valid, got %s", vr.EventChain)
	}
	if len(vr.Links) != 1 || vr.Links[0].RecordSigValid == nil || !*vr.Links[0].RecordSigValid {
		t.Fatalf("record_sig_valid: want true, got %+v", vr.Links)
	}

	// Tamper with one audit event → event chain must go invalid.
	if _, err := p.Exec(ctx,
		"UPDATE document_sign_event SET ip_address='6.6.6.6' WHERE envelope_id=$1 AND event_type='signed'", env.ID); err != nil {
		t.Fatalf("tamper: %v", err)
	}
	vr2, err := svc.VerifyChain(ctx, tid, env.ID)
	if err != nil {
		t.Fatalf("verify2: %v", err)
	}
	if vr2.Valid || vr2.EventChain != domain.EventChainInvalid {
		t.Fatalf("after event tamper: want valid=false event_chain=invalid, got valid=%v chain=%s", vr2.Valid, vr2.EventChain)
	}

	// Restore the event row — chain must verify again.
	if _, err := p.Exec(ctx,
		"UPDATE document_sign_event SET ip_address='192.0.2.1' WHERE envelope_id=$1 AND event_type='signed'", env.ID); err != nil {
		t.Fatalf("restore: %v", err)
	}
	vr3, _ := svc.VerifyChain(ctx, tid, env.ID)
	if !vr3.Valid || vr3.EventChain != domain.EventChainValid {
		t.Fatalf("after restore: want valid, got valid=%v chain=%s", vr3.Valid, vr3.EventChain)
	}

	// Whole-chain recompute attack: a DB-write attacker edits the bound
	// version body AND consistently recomputes content_hash + chained_hash.
	// SHA-256 alone would pass — the Ed25519 record signature must catch it.
	full2, _ := svc.Signatures.GetEnvelope(ctx, tid, env.ID)
	sg := full2.Signers[0]
	newBody := map[string]any{"type": "doc", "content": []any{"FORGED"}}
	newContent := domain.CanonicalContentHash(newBody)
	forgedChain := domain.ChainHash("", newContent, sg.SignerID.String(),
		sg.SignedAt.UTC().Format(time.RFC3339Nano), string(sg.AuthMethod), sg.TypedName)
	if _, err := p.Exec(ctx,
		`UPDATE document_version SET body=$2 WHERE id=$1`, *full2.VersionID, newBody); err != nil {
		t.Fatalf("forge body: %v", err)
	}
	if _, err := p.Exec(ctx,
		`UPDATE document_signature SET content_hash=$2, chained_hash=$3 WHERE id=$1`,
		sg.ID, newContent, forgedChain); err != nil {
		t.Fatalf("forge hashes: %v", err)
	}
	vr4, err := svc.VerifyChain(ctx, tid, env.ID)
	if err != nil {
		t.Fatalf("verify4: %v", err)
	}
	if vr4.Valid {
		t.Fatal("recompute attack must be caught by record_sig verification")
	}
	if len(vr4.Links) != 1 || vr4.Links[0].RecordSigValid == nil || *vr4.Links[0].RecordSigValid {
		t.Fatalf("record_sig_valid: want false after forge, got %+v", vr4.Links)
	}
}
