package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/document-svc/internal/domain"
	"github.com/pmplatform/services/document-svc/internal/service"
	"github.com/pmplatform/services/document-svc/internal/store"
)

// otpFixture seeds a sent envelope with one email_otp signer (A) and one
// session signer (B), parallel order so both are active.
type otpFixture struct {
	svc      *service.Service
	tid      uuid.UUID
	envID    uuid.UUID
	signerA  uuid.UUID // user uuid (email_otp)
	signerB  uuid.UUID // user uuid (session)
	rowA     uuid.UUID // signature row ids
	rowB     uuid.UUID
	asA, asB service.AuditMeta
}

func seedOTPEnvelope(t *testing.T, p *pgxpool.Pool) otpFixture {
	t.Helper()
	ctx := context.Background()
	tid, pid := seedTenantProject(t, p)
	svc := newSvc(p)

	ws, err := svc.Workspaces.EnsureForProject(ctx, tid, pid, domain.WSKindBA, "WS")
	if err != nil {
		t.Fatalf("ws: %v", err)
	}
	doc, err := svc.CreateDocument(ctx, service.CreateDocumentInput{
		TenantID: tid, WorkspaceID: ws.ID, ProjectID: pid,
		Type: domain.DocumentType("brd"), Title: "OTP Contract",
		Body: map[string]any{"type": "doc", "content": []any{map[string]any{"text": "otp agreement"}}},
	})
	if err != nil {
		t.Fatalf("doc: %v", err)
	}

	signerA, signerB := uuid.New(), uuid.New()
	env, err := svc.CreateEnvelope(ctx, service.CreateEnvelopeInput{
		TenantID: tid, DocumentID: doc.ID, SigningOrder: domain.OrderParallel,
		Signers: []store.NewSignerInput{
			{SignerID: signerA, Name: "A", Email: "a@x.com", AuthMethod: domain.AuthEmailOTP},
			{SignerID: signerB, Name: "B", Email: "b@x.com"},
		},
	})
	if err != nil {
		t.Fatalf("envelope: %v", err)
	}
	asA := service.AuditMeta{IPAddress: "198.51.100.7", UserAgent: "T/1", ActorID: &signerA}
	asB := service.AuditMeta{IPAddress: "198.51.100.8", UserAgent: "T/1", ActorID: &signerB}
	if _, err := svc.SendEnvelope(ctx, tid, env.ID, asA); err != nil {
		t.Fatalf("send: %v", err)
	}
	full, err := svc.Signatures.GetEnvelope(ctx, tid, env.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	return otpFixture{
		svc: svc, tid: tid, envID: env.ID,
		signerA: signerA, signerB: signerB,
		rowA: full.Signers[0].ID, rowB: full.Signers[1].ID,
		asA: asA, asB: asB,
	}
}

func TestOTPRequestAndVerifyFlow(t *testing.T) {
	t.Setenv("OTP_DEV_EXPOSE", "true")
	p := pool(t)
	defer p.Close()
	fx := seedOTPEnvelope(t, p)
	ctx := context.Background()

	// Signing without a code → 428 taxonomy (ErrOTPRequired).
	_, err := fx.svc.SignEnvelopeSigner(ctx, service.SignInput{
		TenantID: fx.tid, EnvelopeID: fx.envID, SignerRowID: fx.rowA,
		Consent: true, TypedName: "A",
	}, fx.asA)
	if !errors.Is(err, domain.ErrOTPRequired) {
		t.Fatalf("sign without code: want ErrOTPRequired, got %v", err)
	}

	// Cross-signer request: B requesting A's OTP → forbidden.
	if _, err := fx.svc.RequestSignOTP(ctx, fx.tid, fx.envID, fx.rowA, fx.asB); !errors.Is(err, domain.ErrForbidden) {
		t.Fatalf("cross request: want ErrForbidden, got %v", err)
	}

	// Requesting OTP for a non-OTP signer row → invalid input.
	if _, err := fx.svc.RequestSignOTP(ctx, fx.tid, fx.envID, fx.rowB, fx.asB); !errors.Is(err, domain.ErrInvalidInput) {
		t.Fatalf("non-otp signer request: want ErrInvalidInput, got %v", err)
	}

	// A requests their own OTP → challenge issued, dev code exposed.
	ch, err := fx.svc.RequestSignOTP(ctx, fx.tid, fx.envID, fx.rowA, fx.asA)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if ch.DevCode == "" || len(ch.DevCode) != 6 {
		t.Fatalf("dev code not exposed: %+v", ch)
	}

	// Wrong code → ErrOTPInvalid, attempts incremented.
	wrong := "000000"
	if wrong == ch.DevCode {
		wrong = "999999"
	}
	_, err = fx.svc.SignEnvelopeSigner(ctx, service.SignInput{
		TenantID: fx.tid, EnvelopeID: fx.envID, SignerRowID: fx.rowA,
		Consent: true, TypedName: "A", OTPCode: wrong,
	}, fx.asA)
	if !errors.Is(err, domain.ErrOTPInvalid) {
		t.Fatalf("wrong code: want ErrOTPInvalid, got %v", err)
	}
	var attempts int
	if err := p.QueryRow(ctx,
		`SELECT attempts FROM document_sign_otp WHERE id=$1`, ch.ChallengeID).Scan(&attempts); err != nil {
		t.Fatalf("attempts read: %v", err)
	}
	if attempts != 1 {
		t.Fatalf("attempts: want 1, got %d", attempts)
	}

	// Correct code → signed, auth_evidence persisted, otp_verified in chain.
	res, err := fx.svc.SignEnvelopeSigner(ctx, service.SignInput{
		TenantID: fx.tid, EnvelopeID: fx.envID, SignerRowID: fx.rowA,
		Consent: true, TypedName: "A", OTPCode: ch.DevCode,
	}, fx.asA)
	if err != nil {
		t.Fatalf("sign with code: %v", err)
	}
	if res.Signer.AuthMethod != domain.AuthEmailOTP {
		t.Fatalf("auth_method: want email_otp, got %s", res.Signer.AuthMethod)
	}
	var evidence []byte
	if err := p.QueryRow(ctx,
		`SELECT auth_evidence FROM document_signature WHERE id=$1`, fx.rowA).Scan(&evidence); err != nil {
		t.Fatalf("evidence read: %v", err)
	}
	if len(evidence) == 0 {
		t.Fatal("auth_evidence not persisted")
	}
	events, err := fx.svc.Signatures.ListEvents(ctx, fx.tid, fx.envID)
	if err != nil {
		t.Fatalf("events: %v", err)
	}
	foundReq, foundVerified := false, false
	for _, ev := range events {
		if ev.EventType == domain.EvOTPRequested {
			foundReq = true
		}
		if ev.EventType == domain.EvOTPVerified {
			foundVerified = true
			if ev.EventHash == nil {
				t.Fatal("otp_verified event not on the hash chain")
			}
		}
	}
	if !foundReq || !foundVerified {
		t.Fatalf("audit trail missing otp events (requested=%v verified=%v)", foundReq, foundVerified)
	}

	// B (session signer) signs normally — completely unaffected by OTP.
	resB, err := fx.svc.SignEnvelopeSigner(ctx, service.SignInput{
		TenantID: fx.tid, EnvelopeID: fx.envID, SignerRowID: fx.rowB,
		Consent: true, TypedName: "B",
	}, fx.asB)
	if err != nil {
		t.Fatalf("B sign: %v", err)
	}
	if !resB.Completed {
		t.Fatal("envelope should be completed")
	}

	// Chain still verifies end-to-end with OTP events present.
	vr, err := fx.svc.VerifyChain(ctx, fx.tid, fx.envID)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !vr.Valid {
		t.Fatalf("chain invalid: %+v", vr)
	}
	if len(vr.Links) != 2 || vr.Links[0].AuthMethod != string(domain.AuthEmailOTP) {
		t.Fatalf("verify links missing auth_method: %+v", vr.Links)
	}
}

func TestOTPExpiry(t *testing.T) {
	t.Setenv("OTP_DEV_EXPOSE", "true")
	p := pool(t)
	defer p.Close()
	fx := seedOTPEnvelope(t, p)
	ctx := context.Background()

	ch, err := fx.svc.RequestSignOTP(ctx, fx.tid, fx.envID, fx.rowA, fx.asA)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if _, err := p.Exec(ctx,
		`UPDATE document_sign_otp SET expires_at = now() - interval '1 minute' WHERE id=$1`, ch.ChallengeID); err != nil {
		t.Fatalf("expire: %v", err)
	}
	_, err = fx.svc.SignEnvelopeSigner(ctx, service.SignInput{
		TenantID: fx.tid, EnvelopeID: fx.envID, SignerRowID: fx.rowA,
		Consent: true, TypedName: "A", OTPCode: ch.DevCode,
	}, fx.asA)
	if !errors.Is(err, domain.ErrOTPExpired) {
		t.Fatalf("expired code: want ErrOTPExpired, got %v", err)
	}
}

func TestOTPAttemptsExhausted(t *testing.T) {
	t.Setenv("OTP_DEV_EXPOSE", "true")
	p := pool(t)
	defer p.Close()
	fx := seedOTPEnvelope(t, p)
	ctx := context.Background()

	ch, err := fx.svc.RequestSignOTP(ctx, fx.tid, fx.envID, fx.rowA, fx.asA)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	wrong := "000000"
	if wrong == ch.DevCode {
		wrong = "999999"
	}
	for i := 0; i < domain.OTPMaxAttempts; i++ {
		_, err := fx.svc.SignEnvelopeSigner(ctx, service.SignInput{
			TenantID: fx.tid, EnvelopeID: fx.envID, SignerRowID: fx.rowA,
			Consent: true, TypedName: "A", OTPCode: wrong,
		}, fx.asA)
		if !errors.Is(err, domain.ErrOTPInvalid) {
			t.Fatalf("attempt %d: want ErrOTPInvalid, got %v", i, err)
		}
	}
	// Even the CORRECT code is dead once attempts are exhausted.
	_, err = fx.svc.SignEnvelopeSigner(ctx, service.SignInput{
		TenantID: fx.tid, EnvelopeID: fx.envID, SignerRowID: fx.rowA,
		Consent: true, TypedName: "A", OTPCode: ch.DevCode,
	}, fx.asA)
	if !errors.Is(err, domain.ErrOTPInvalid) {
		t.Fatalf("exhausted challenge: want ErrOTPInvalid, got %v", err)
	}
}

func TestOTPRateLimit(t *testing.T) {
	t.Setenv("OTP_DEV_EXPOSE", "true")
	p := pool(t)
	defer p.Close()
	fx := seedOTPEnvelope(t, p)
	ctx := context.Background()

	for i := 0; i < domain.OTPRateLimitMax; i++ {
		if _, err := fx.svc.RequestSignOTP(ctx, fx.tid, fx.envID, fx.rowA, fx.asA); err != nil {
			t.Fatalf("request %d: %v", i, err)
		}
	}
	if _, err := fx.svc.RequestSignOTP(ctx, fx.tid, fx.envID, fx.rowA, fx.asA); !errors.Is(err, domain.ErrOTPRateLimited) {
		t.Fatalf("4th request: want ErrOTPRateLimited, got %v", err)
	}
	// Outside the window the limiter resets.
	if _, err := p.Exec(ctx,
		`UPDATE document_sign_otp SET created_at = created_at - interval '10 minutes'
		 WHERE signer_id=$1`, fx.rowA); err != nil {
		t.Fatalf("age rows: %v", err)
	}
	if _, err := fx.svc.RequestSignOTP(ctx, fx.tid, fx.envID, fx.rowA, fx.asA); err != nil {
		t.Fatalf("request after window: %v", err)
	}
}

// TestOTPNewRequestSupersedesOld: requesting a fresh code invalidates the
// prior open challenge — the OLD code must stop working.
func TestOTPNewRequestSupersedesOld(t *testing.T) {
	t.Setenv("OTP_DEV_EXPOSE", "true")
	p := pool(t)
	defer p.Close()
	fx := seedOTPEnvelope(t, p)
	ctx := context.Background()

	ch1, err := fx.svc.RequestSignOTP(ctx, fx.tid, fx.envID, fx.rowA, fx.asA)
	if err != nil {
		t.Fatalf("request1: %v", err)
	}
	ch2, err := fx.svc.RequestSignOTP(ctx, fx.tid, fx.envID, fx.rowA, fx.asA)
	if err != nil {
		t.Fatalf("request2: %v", err)
	}
	if ch1.ChallengeID == ch2.ChallengeID {
		t.Fatal("expected a fresh challenge")
	}
	// Old code no longer valid (unless RNG collided — guard).
	if ch1.DevCode != ch2.DevCode {
		_, err = fx.svc.SignEnvelopeSigner(ctx, service.SignInput{
			TenantID: fx.tid, EnvelopeID: fx.envID, SignerRowID: fx.rowA,
			Consent: true, TypedName: "A", OTPCode: ch1.DevCode,
		}, fx.asA)
		if !errors.Is(err, domain.ErrOTPInvalid) {
			t.Fatalf("old code: want ErrOTPInvalid, got %v", err)
		}
	}
	// New code signs fine.
	if _, err := fx.svc.SignEnvelopeSigner(ctx, service.SignInput{
		TenantID: fx.tid, EnvelopeID: fx.envID, SignerRowID: fx.rowA,
		Consent: true, TypedName: "A", OTPCode: ch2.DevCode,
	}, fx.asA); err != nil {
		t.Fatalf("new code: %v", err)
	}
}

// TestOTPDevCodeHiddenByDefault: without OTP_DEV_EXPOSE=true the response
// must NOT leak the code.
func TestOTPDevCodeHiddenByDefault(t *testing.T) {
	t.Setenv("OTP_DEV_EXPOSE", "")
	p := pool(t)
	defer p.Close()
	fx := seedOTPEnvelope(t, p)

	ch, err := fx.svc.RequestSignOTP(context.Background(), fx.tid, fx.envID, fx.rowA, fx.asA)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if ch.DevCode != "" {
		t.Fatal("dev_code leaked without OTP_DEV_EXPOSE")
	}
	if time.Until(ch.ExpiresAt) <= 0 {
		t.Fatal("challenge already expired at issuance")
	}
}
