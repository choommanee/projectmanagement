package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math/big"
	"os"
	"time"

	"github.com/google/uuid"

	notiflib "github.com/pmplatform/libs/go/notification"

	"github.com/pmplatform/services/document-svc/internal/domain"
)

// --- Email-OTP step-up flow (auth_method=email_otp) --------------------------
//
// DocuSign-style: the signer requests a 6-digit code (emailed via the
// notification pipeline), then submits it with the sign request. Codes live
// 10 minutes, allow 5 attempts, and requests are rate-limited 3/5min/signer.

// RequestSignOTPResult is the response of POST .../otp/request.
type RequestSignOTPResult struct {
	ChallengeID uuid.UUID `json:"challenge_id"`
	ExpiresAt   time.Time `json:"expires_at"`
	// DevCode is ONLY populated when OTP_DEV_EXPOSE=true (local/E2E escape
	// hatch — NATS/notification-svc may be down in dev). Never set in prod.
	DevCode string `json:"dev_code,omitempty"`
}

// RequestSignOTP issues a fresh email-OTP challenge for a signer row. Only
// the signer themself may request (same actor enforcement as sign/decline).
// The 6-digit code is emailed via the notification publisher; only
// SHA-256(code||salt) is stored.
func (svc *Service) RequestSignOTP(ctx context.Context, tid, envID, signerRowID uuid.UUID, am AuditMeta) (*RequestSignOTPResult, error) {
	env, err := svc.Signatures.GetEnvelope(ctx, tid, envID)
	if err != nil {
		return nil, err
	}
	row, err := requireActor(env, signerRowID, am)
	if err != nil {
		return nil, err
	}
	if row.AuthMethod != domain.AuthEmailOTP {
		return nil, domain.ErrInvalidInput // OTP only applies to email_otp signers
	}
	if env.Status != domain.EnvSent || row.Status != domain.SigPending {
		return nil, domain.ErrInvalidInput // nothing to sign — no challenge to issue
	}

	code, err := generateOTPCode()
	if err != nil {
		return nil, err
	}
	salt, err := generateOTPSalt()
	if err != nil {
		return nil, err
	}

	ch, err := svc.Signatures.CreateOTPChallenge(ctx, tid, envID, signerRowID,
		domain.HashOTPCode(code, salt), salt)
	if err != nil {
		return nil, err
	}

	// Email channel via the shared notification pipeline. With NATS down the
	// publisher is a no-op (dev) — OTP_DEV_EXPOSE covers local testing.
	_ = svc.notif().Publish(ctx, notiflib.Event{
		TenantID: tid.String(),
		UserID:   row.SignerID.String(),
		Kind:     "document.sign_otp",
		Title:    "Your signing verification code",
		Body: fmt.Sprintf("Your verification code for signing %q is %s. It expires in %d minutes.",
			env.Title, code, int(domain.OTPExpiry.Minutes())),
		Payload: map[string]any{
			"envelope_id":  envID.String(),
			"document_id":  env.DocumentID.String(),
			"signer_row":   signerRowID.String(),
			"challenge_id": ch.ID.String(),
		},
	})

	_ = svc.Signatures.RecordEvent(ctx, domain.SignEvent{
		TenantID: tid, EnvelopeID: envID, SignerID: &row.SignerID, EventType: domain.EvOTPRequested,
		ActorID: am.ActorID, IPAddress: am.IPAddress, UserAgent: am.UserAgent, Geo: am.Geo,
		Metadata: map[string]any{"challenge_id": ch.ID.String()},
	})

	res := &RequestSignOTPResult{ChallengeID: ch.ID, ExpiresAt: ch.ExpiresAt}
	if os.Getenv("OTP_DEV_EXPOSE") == "true" {
		res.DevCode = code
	}
	return res, nil
}

// enforceSignOTP gates the sign path for email_otp signers: requires
// in.OTPCode, verifies + consumes the open challenge, records the
// otp_verified audit event, and returns the AuthEvidence to persist on the
// signature row. Non-OTP signers pass through untouched (nil, nil).
func (svc *Service) enforceSignOTP(ctx context.Context, in SignInput, row *domain.Signer, am AuditMeta) (*domain.AuthEvidence, error) {
	if row.AuthMethod != domain.AuthEmailOTP {
		return nil, nil
	}
	if in.OTPCode == "" {
		return nil, domain.ErrOTPRequired
	}
	ch, err := svc.Signatures.ConsumeOTPChallenge(ctx, in.TenantID, in.SignerRowID, in.OTPCode)
	if err != nil {
		return nil, err
	}
	verifiedAt := time.Now().UTC()
	if ch.ConsumedAt != nil {
		verifiedAt = *ch.ConsumedAt
	}
	_ = svc.Signatures.RecordEvent(ctx, domain.SignEvent{
		TenantID: in.TenantID, EnvelopeID: in.EnvelopeID, SignerID: &row.SignerID, EventType: domain.EvOTPVerified,
		ActorID: am.ActorID, IPAddress: am.IPAddress, UserAgent: am.UserAgent, Geo: am.Geo,
		Metadata: map[string]any{"challenge_id": ch.ID.String(), "method": string(domain.AuthEmailOTP)},
	})
	return &domain.AuthEvidence{
		Method:      string(domain.AuthEmailOTP),
		ChallengeID: ch.ID,
		VerifiedAt:  verifiedAt,
	}, nil
}

// recordAuthEvidence persists the step-up proof on the signed row.
// Non-fatal by design: the signature itself already carries the hash chain.
func (svc *Service) recordAuthEvidence(ctx context.Context, tid, signerRowID uuid.UUID, ev *domain.AuthEvidence) {
	if ev == nil {
		return
	}
	_ = svc.Signatures.SetAuthEvidence(ctx, tid, signerRowID, *ev)
}

// generateOTPCode returns a crypto-random 6-digit code ("000000".."999999").
func generateOTPCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// generateOTPSalt returns 16 random bytes hex-encoded.
func generateOTPSalt() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
