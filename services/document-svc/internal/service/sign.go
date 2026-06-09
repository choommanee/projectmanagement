package service

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	notiflib "github.com/pmplatform/libs/go/notification"

	"github.com/pmplatform/services/document-svc/internal/cert"
	"github.com/pmplatform/services/document-svc/internal/domain"
	"github.com/pmplatform/services/document-svc/internal/store"
)

// EventEmitter publishes domain NATS events (e.g. document.sign_requested)
// that other services (workflow-svc) subscribe to. Decoupled behind an
// interface so the service stays testable with a noop.
type EventEmitter interface {
	Emit(ctx context.Context, subject string, payload map[string]any) error
}

// NoopEmitter discards events.
type NoopEmitter struct{}

// Emit implements EventEmitter.
func (NoopEmitter) Emit(_ context.Context, _ string, _ map[string]any) error { return nil }

// WithNotifPublisher attaches the notification publisher.
func (svc *Service) WithNotifPublisher(p notiflib.Publisher) *Service {
	svc.Notif = p
	return svc
}

// WithEventEmitter attaches the domain-event emitter.
func (svc *Service) WithEventEmitter(e EventEmitter) *Service {
	svc.Events = e
	return svc
}

func (svc *Service) notif() notiflib.Publisher {
	if svc.Notif == nil {
		return notiflib.NoopPublisher{}
	}
	return svc.Notif
}

func (svc *Service) emitter() EventEmitter {
	if svc.Events == nil {
		return NoopEmitter{}
	}
	return svc.Events
}

// CreateEnvelopeInput holds params for creating a signing envelope.
type CreateEnvelopeInput struct {
	TenantID     uuid.UUID
	DocumentID   uuid.UUID
	Title        string
	SigningOrder domain.SigningOrder
	CreatedBy    *uuid.UUID
	ExpiresAt    *time.Time
	Signers      []store.NewSignerInput
}

// CreateEnvelope validates and creates a draft envelope bound to the document's
// current version.
func (svc *Service) CreateEnvelope(ctx context.Context, in CreateEnvelopeInput) (*domain.SignEnvelope, error) {
	if in.DocumentID == uuid.Nil {
		return nil, domain.ErrInvalidInput
	}
	if len(in.Signers) == 0 {
		return nil, domain.ErrInvalidInput
	}
	order := in.SigningOrder
	if order == "" {
		order = domain.OrderSequential
	}
	if !order.Valid() {
		return nil, domain.ErrInvalidInput
	}
	for i := range in.Signers {
		if in.Signers[i].SignerID == uuid.Nil {
			return nil, domain.ErrInvalidInput
		}
		if in.Signers[i].AuthMethod != "" && !in.Signers[i].AuthMethod.Valid() {
			return nil, domain.ErrInvalidInput
		}
	}

	// Bind to the document's current version + title.
	doc, err := svc.Documents.GetByID(ctx, in.TenantID, in.DocumentID)
	if err != nil {
		return nil, err
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = doc.Title
	}

	return svc.Signatures.CreateEnvelope(ctx, store.CreateEnvelopeInput{
		TenantID:     in.TenantID,
		DocumentID:   in.DocumentID,
		VersionID:    doc.CurrentVersionID,
		Title:        title,
		SigningOrder: order,
		CreatedBy:    in.CreatedBy,
		ExpiresAt:    in.ExpiresAt,
		Signers:      in.Signers,
	})
}

// AuditMeta carries request-scoped audit context for signer actions.
type AuditMeta struct {
	IPAddress string
	UserAgent string
	Geo       string
	ActorID   *uuid.UUID
}

// SendEnvelope moves draft->sent, records the event, notifies the active
// signer(s), and emits document.sign_requested for workflow triggers.
func (svc *Service) SendEnvelope(ctx context.Context, tid, envID uuid.UUID, am AuditMeta) (*domain.SignEnvelope, error) {
	env, err := svc.Signatures.Send(ctx, tid, envID)
	if err != nil {
		return nil, err
	}
	_ = svc.Signatures.RecordEvent(ctx, domain.SignEvent{
		TenantID: tid, EnvelopeID: envID, EventType: domain.EvSent,
		ActorID: am.ActorID, IPAddress: am.IPAddress, UserAgent: am.UserAgent, Geo: am.Geo,
	})

	full, err := svc.Signatures.GetEnvelope(ctx, tid, envID)
	if err == nil {
		for _, s := range full.Signers {
			if s.RoutingStatus == domain.RouteActive {
				_ = svc.notif().Publish(ctx, notiflib.Event{
					TenantID: tid.String(),
					UserID:   s.SignerID.String(),
					Kind:     "document.sign_requested",
					Title:    "Signature requested",
					Body:     "You have a document awaiting your signature: " + env.Title,
					Payload: map[string]any{
						"envelope_id": envID.String(),
						"document_id": env.DocumentID.String(),
						"signer_row":  s.ID.String(),
					},
				})
			}
		}
		// domain event for workflow-svc
		_ = svc.emitter().Emit(ctx, "document.sign_requested", map[string]any{
			"tenant_id":   tid.String(),
			"envelope_id": envID.String(),
			"document_id": env.DocumentID.String(),
			"signer_count": len(full.Signers),
		})
	}
	return env, nil
}

// ViewEnvelopeSigner records a 'viewed' event for a signer. The JWT actor
// must match the signer row's signer_id (403 otherwise) so viewed_at and the
// viewed audit event cannot be forged onto someone else's row.
func (svc *Service) ViewEnvelopeSigner(ctx context.Context, tid, envID, signerRowID uuid.UUID, am AuditMeta) (*domain.Signer, error) {
	cur, err := svc.Signatures.GetEnvelope(ctx, tid, envID)
	if err != nil {
		return nil, err
	}
	if _, err := requireActor(cur, signerRowID, am); err != nil {
		return nil, err
	}
	sg, err := svc.Signatures.MarkViewed(ctx, tid, envID, signerRowID)
	if err != nil {
		return nil, err
	}
	_ = svc.Signatures.RecordEvent(ctx, domain.SignEvent{
		TenantID: tid, EnvelopeID: envID, SignerID: &sg.SignerID, EventType: domain.EvViewed,
		ActorID: am.ActorID, IPAddress: am.IPAddress, UserAgent: am.UserAgent, Geo: am.Geo,
	})
	return sg, nil
}

// SignInput holds the data a signer submits.
type SignInput struct {
	TenantID    uuid.UUID
	EnvelopeID  uuid.UUID
	SignerRowID uuid.UUID
	Consent     bool
	TypedName   string
	ImageBytes  []byte
	AuthMethod  domain.AuthMethod
	// OTPCode is the email-OTP step-up code; required when the signer row's
	// auth_method is email_otp (enforced in SignEnvelopeSigner).
	OTPCode string
}

// findSignerRow locates a signer row inside a loaded envelope.
func findSignerRow(env *domain.SignEnvelope, signerRowID uuid.UUID) *domain.Signer {
	for i := range env.Signers {
		if env.Signers[i].ID == signerRowID {
			return &env.Signers[i]
		}
	}
	return nil
}

// requireActor enforces server-side signer identity: the authenticated JWT
// actor MUST be the user the signer row was routed to. Cedar's
// document.sign.* policy deliberately permits any authenticated tenant user
// and delegates this row-level check to the service layer — this is that
// check. ErrForbidden maps to HTTP 403.
//
// FAIL CLOSED: a principal without a concrete user-UUID identity (am.ActorID
// == nil) is rejected outright. ActorID is nil whenever the JWT subject does
// not parse as a UUID — notably service tokens whose subject is
// "svc:<service>". Letting such a principal through would allow a
// service-token holder to sign/view/decline ANY signer row, breaking
// non-repudiation. All callers (view/sign/decline/otp.request) are
// signer-identity-gated mutations; the public verify endpoints do NOT route
// through requireActor, so this is safe.
func requireActor(env *domain.SignEnvelope, signerRowID uuid.UUID, am AuditMeta) (*domain.Signer, error) {
	row := findSignerRow(env, signerRowID)
	if row == nil {
		return nil, domain.ErrNotFound
	}
	if am.ActorID == nil {
		return nil, domain.ErrForbidden // no concrete signer identity → never allow
	}
	if *am.ActorID != row.SignerID {
		return nil, domain.ErrForbidden
	}
	return row, nil
}

// SignEnvelopeSigner records a signature with the hash chain, advances
// routing, completes the envelope + generates the certificate when last, and
// fires notifications/events. ESIGN requires explicit consent: a sign without
// consent=true is rejected. The JWT actor must match the signer row's
// signer_id (403 otherwise).
func (svc *Service) SignEnvelopeSigner(ctx context.Context, in SignInput, am AuditMeta) (*store.SignResult, error) {
	if !in.Consent {
		return nil, domain.ErrInvalidInput // consent-to-electronic-records required
	}
	// Resolve the version body bound to this envelope for the content hash.
	env, err := svc.Signatures.GetEnvelope(ctx, in.TenantID, in.EnvelopeID)
	if err != nil {
		return nil, err
	}
	row, err := requireActor(env, in.SignerRowID, am)
	if err != nil {
		return nil, err
	}
	// Email-OTP step-up: email_otp signers must prove email possession before
	// signing. Verifies + consumes the open challenge and records the
	// otp_verified audit event; non-OTP signers pass through (nil evidence).
	otpEvidence, err := svc.enforceSignOTP(ctx, in, row, am)
	if err != nil {
		return nil, err
	}
	if row.AuthMethod == domain.AuthEmailOTP {
		in.AuthMethod = domain.AuthEmailOTP // row's method is authoritative
	}
	var body map[string]any
	if env.VersionID != nil {
		v, err := svc.Documents.GetVersionByID(ctx, in.TenantID, *env.VersionID)
		if err != nil {
			return nil, err
		}
		body = v.Body
	} else {
		doc, err := svc.Documents.GetByID(ctx, in.TenantID, env.DocumentID)
		if err != nil {
			return nil, err
		}
		body = doc.Body
	}

	// Record consent event before the sign.
	res, err := svc.Signatures.Sign(ctx, store.SignInput{
		TenantID:    in.TenantID,
		EnvelopeID:  in.EnvelopeID,
		SignerRowID: in.SignerRowID,
		Consent:     in.Consent,
		TypedName:   in.TypedName,
		ImageBytes:  in.ImageBytes,
		AuthMethod:  in.AuthMethod,
		ContentBody: body,
	})
	if err != nil {
		return nil, err
	}

	// Persist step-up proof (auth_evidence jsonb) on the signed row.
	svc.recordAuthEvidence(ctx, in.TenantID, in.SignerRowID, otpEvidence)

	_ = svc.Signatures.RecordEvent(ctx, domain.SignEvent{
		TenantID: in.TenantID, EnvelopeID: in.EnvelopeID, SignerID: &res.Signer.SignerID, EventType: domain.EvConsented,
		ActorID: am.ActorID, IPAddress: am.IPAddress, UserAgent: am.UserAgent, Geo: am.Geo,
	})
	_ = svc.Signatures.RecordEvent(ctx, domain.SignEvent{
		TenantID: in.TenantID, EnvelopeID: in.EnvelopeID, SignerID: &res.Signer.SignerID, EventType: domain.EvSigned,
		ActorID: am.ActorID, IPAddress: am.IPAddress, UserAgent: am.UserAgent, Geo: am.Geo,
		Metadata: map[string]any{"auth_method": string(res.Signer.AuthMethod), "chained_hash": res.Signer.ChainedHash},
	})

	if res.Completed {
		_ = svc.Signatures.RecordEvent(ctx, domain.SignEvent{
			TenantID: in.TenantID, EnvelopeID: in.EnvelopeID, EventType: domain.EvCompleted,
			IPAddress: am.IPAddress, UserAgent: am.UserAgent, Geo: am.Geo,
		})
		if err := svc.generateCertificate(ctx, in.TenantID, in.EnvelopeID); err != nil {
			// non-fatal: certificate can be regenerated on demand, but operators
			// must be able to detect that completion-time generation failed.
			log.Warn().Err(err).
				Str("tenant_id", in.TenantID.String()).
				Str("envelope_id", in.EnvelopeID.String()).
				Msg("certificate generation failed after envelope completion — regenerable on demand")
		}
		if res.Envelope.CreatedBy != nil {
			_ = svc.notif().Publish(ctx, notiflib.Event{
				TenantID: in.TenantID.String(),
				UserID:   res.Envelope.CreatedBy.String(),
				Kind:     "document.sign_completed",
				Title:    "Signing complete",
				Body:     "All signers have completed: " + res.Envelope.Title,
				Payload:  map[string]any{"envelope_id": in.EnvelopeID.String(), "document_id": res.Envelope.DocumentID.String()},
			})
		}
		_ = svc.emitter().Emit(ctx, "document.sign_completed", map[string]any{
			"tenant_id": in.TenantID.String(), "envelope_id": in.EnvelopeID.String(),
			"document_id": res.Envelope.DocumentID.String(),
		})
	} else {
		// notify next active signer (sequential)
		full, e := svc.Signatures.GetEnvelope(ctx, in.TenantID, in.EnvelopeID)
		if e == nil {
			for _, s := range full.Signers {
				if s.RoutingStatus == domain.RouteActive {
					_ = svc.notif().Publish(ctx, notiflib.Event{
						TenantID: in.TenantID.String(), UserID: s.SignerID.String(),
						Kind:  "document.sign_requested",
						Title: "Signature requested",
						Body:  "It's your turn to sign: " + full.Title,
						Payload: map[string]any{
							"envelope_id": in.EnvelopeID.String(), "document_id": full.DocumentID.String(), "signer_row": s.ID.String()},
					})
				}
			}
		}
	}
	return res, nil
}

// DeclineEnvelopeSigner records a decline. The JWT actor must match the
// signer row's signer_id (403 otherwise).
func (svc *Service) DeclineEnvelopeSigner(ctx context.Context, tid, envID, signerRowID uuid.UUID, reason string, am AuditMeta) (*domain.Signer, *domain.SignEnvelope, error) {
	cur, err := svc.Signatures.GetEnvelope(ctx, tid, envID)
	if err != nil {
		return nil, nil, err
	}
	if _, err := requireActor(cur, signerRowID, am); err != nil {
		return nil, nil, err
	}
	sg, env, err := svc.Signatures.Decline(ctx, tid, envID, signerRowID, reason)
	if err != nil {
		return nil, nil, err
	}
	_ = svc.Signatures.RecordEvent(ctx, domain.SignEvent{
		TenantID: tid, EnvelopeID: envID, SignerID: &sg.SignerID, EventType: domain.EvDeclined,
		ActorID: am.ActorID, IPAddress: am.IPAddress, UserAgent: am.UserAgent, Geo: am.Geo,
		Metadata: map[string]any{"reason": reason},
	})
	if env.CreatedBy != nil {
		_ = svc.notif().Publish(ctx, notiflib.Event{
			TenantID: tid.String(), UserID: env.CreatedBy.String(),
			Kind: "document.sign_declined", Title: "Signature declined",
			Body: "A signer declined: " + env.Title,
			Payload: map[string]any{
				"envelope_id": envID.String(),
				"document_id": env.DocumentID.String(),
				"reason":      reason,
			},
		})
	}
	// domain event for workflow-svc — correlated by envelope_id
	_ = svc.emitter().Emit(ctx, "document.sign_declined", map[string]any{
		"tenant_id":   tid.String(),
		"envelope_id": envID.String(),
		"document_id": env.DocumentID.String(),
		"reason":      reason,
	})
	return sg, env, nil
}

// VoidEnvelope voids an envelope.
func (svc *Service) VoidEnvelope(ctx context.Context, tid, envID uuid.UUID, reason string, am AuditMeta) (*domain.SignEnvelope, error) {
	env, err := svc.Signatures.Void(ctx, tid, envID, reason)
	if err != nil {
		return nil, err
	}
	_ = svc.Signatures.RecordEvent(ctx, domain.SignEvent{
		TenantID: tid, EnvelopeID: envID, EventType: domain.EvVoided,
		ActorID: am.ActorID, IPAddress: am.IPAddress, UserAgent: am.UserAgent, Geo: am.Geo,
		Metadata: map[string]any{"reason": reason},
	})
	return env, nil
}

// VerifyChain recomputes the hash chain for a completed/in-progress envelope
// against the CURRENT document content and reports integrity.
func (svc *Service) VerifyChain(ctx context.Context, tid, envID uuid.UUID) (*domain.ChainVerifyResult, error) {
	env, err := svc.Signatures.GetEnvelope(ctx, tid, envID)
	if err != nil {
		return nil, err
	}
	// Current bound content body (version snapshot).
	var body map[string]any
	if env.VersionID != nil {
		v, err := svc.Documents.GetVersionByID(ctx, tid, *env.VersionID)
		if err != nil {
			return nil, err
		}
		body = v.Body
	} else {
		doc, err := svc.Documents.GetByID(ctx, tid, env.DocumentID)
		if err != nil {
			return nil, err
		}
		body = doc.Body
	}
	currentContentHash := domain.CanonicalContentHash(body)

	res := &domain.ChainVerifyResult{EnvelopeID: envID, Valid: true}
	prev := ""
	// Only signed signers participate in the chain, ordered by signing time
	// which for our routing equals order_index ascending.
	for _, s := range env.Signers {
		if s.Status != domain.SigSigned {
			continue
		}
		signedAt := ""
		if s.SignedAt != nil {
			signedAt = s.SignedAt.UTC().Format(time.RFC3339Nano)
		}
		recomputedChain := domain.ChainHash(prev, s.ContentHash, s.SignerID.String(),
			signedAt, string(s.AuthMethod), s.TypedName)

		contentMatches := s.ContentHash == currentContentHash
		chainMatches := recomputedChain == s.ChainedHash && s.PrevHash == prev

		if !contentMatches || !chainMatches {
			res.Valid = false
		}
		link := domain.ChainLinkResult{
			SignerID:          s.SignerID,
			OrderIndex:        s.OrderIndex,
			StoredContentHash: s.ContentHash,
			RecomputedContent: currentContentHash,
			StoredChainedHash: s.ChainedHash,
			RecomputedChained: recomputedChain,
			ContentMatches:    contentMatches,
			ChainMatches:      chainMatches,
			AuthMethod:        string(s.AuthMethod),
		}
		// Ed25519 record signature: proves the STORED chained_hash was
		// produced by this service (defense vs whole-chain recompute by a
		// DB-write attacker). Legacy rows without a sig stay nil.
		if s.RecordSig != "" && s.RecordKid != "" {
			ok := false
			if pub, perr := svc.Signatures.PublicKeyFor(ctx, s.RecordKid); perr == nil {
				if sig, derr := base64.StdEncoding.DecodeString(s.RecordSig); derr == nil {
					ok = ed25519.Verify(pub, []byte(s.ChainedHash), sig)
				}
			}
			link.RecordSigValid = &ok
			if !ok {
				res.Valid = false
			}
		}
		res.Links = append(res.Links, link)
		prev = s.ChainedHash
	}
	if len(res.Links) == 0 {
		res.Reason = "no signed signers in envelope"
	} else if !res.Valid {
		res.Reason = "hash chain mismatch — document content or signature record altered after signing"
	}
	// RFC 3161 trusted-timestamp evidence per link (service/trust.go).
	svc.attachTSAVerify(ctx, tid, env, res)

	// Audit-event hash chain: recompute every hashed event link in insert
	// order. Rows predating 00007 (NULL event_hash) downgrade the report to
	// "legacy" instead of failing.
	events, err := svc.Signatures.ListEvents(ctx, tid, envID)
	if err != nil {
		return nil, err
	}
	prevEv := ""
	legacyCount, hashedCount := 0, 0
	eventsValid := true
	for _, e := range events {
		if e.EventHash == nil {
			legacyCount++
			continue
		}
		hashedCount++
		storedPrev := ""
		if e.PrevEventHash != nil {
			storedPrev = *e.PrevEventHash
		}
		if storedPrev != prevEv || domain.EventChainHash(prevEv, e) != *e.EventHash {
			eventsValid = false
		}
		prevEv = *e.EventHash
	}
	switch {
	case !eventsValid:
		res.EventChain = domain.EventChainInvalid
		res.Valid = false
		if res.Reason == "" {
			res.Reason = "audit event chain mismatch — an audit event was altered after recording"
		}
	case legacyCount > 0:
		res.EventChain = domain.EventChainLegacy
	case hashedCount > 0:
		res.EventChain = domain.EventChainValid
	default:
		res.EventChain = domain.EventChainEmpty
	}
	return res, nil
}

// generateCertificate builds and persists the Certificate of Completion PDF.
func (svc *Service) generateCertificate(ctx context.Context, tid, envID uuid.UUID) error {
	env, err := svc.Signatures.GetEnvelope(ctx, tid, envID)
	if err != nil {
		return err
	}
	events, err := svc.Signatures.ListEvents(ctx, tid, envID)
	if err != nil {
		return err
	}
	var contentHash, finalHash string
	for _, s := range env.Signers {
		if s.Status == domain.SigSigned {
			contentHash = s.ContentHash
			finalHash = s.ChainedHash
		}
	}
	completedAt := time.Now().UTC()
	if env.CompletedAt != nil {
		completedAt = *env.CompletedAt
	}
	// Step-up auth evidence per signer row (email OTP etc.) — best effort.
	evidence, _ := svc.Signatures.ListAuthEvidence(ctx, tid, envID)
	pdf, err := cert.Generate(cert.Data{
		DocumentTitle: env.Title,
		DocumentID:    env.DocumentID.String(),
		EnvelopeID:    env.ID.String(),
		ContentHash:   contentHash,
		FinalHash:     finalHash,
		CompletedAt:   completedAt,
		Signers:       env.Signers,
		Events:        events,
		AuthEvidence:  evidence,
		TSA:           svc.certTSALines(ctx, tid, envID),
	})
	if err != nil {
		return err
	}
	// PAdES-style platform signature over the PDF bytes (service/trust.go);
	// passthrough when no certifier is configured.
	pdf = svc.sealCertificate(pdf)
	return svc.Signatures.SaveCertificate(ctx, tid, envID, env.DocumentID, finalHash, pdf)
}

// GetCertificate returns the certificate PDF, generating it on demand if the
// envelope is completed but no certificate row exists yet.
func (svc *Service) GetCertificate(ctx context.Context, tid, envID uuid.UUID) ([]byte, error) {
	pdf, err := svc.Signatures.GetCertificate(ctx, tid, envID)
	if err == nil {
		return pdf, nil
	}
	if !errors.Is(err, domain.ErrNotFound) {
		return nil, err
	}
	env, gerr := svc.Signatures.GetEnvelope(ctx, tid, envID)
	if gerr != nil {
		return nil, gerr
	}
	if env.Status != domain.EnvCompleted {
		return nil, domain.ErrNotFound // certificate only exists for completed envelopes
	}
	if cerr := svc.generateCertificate(ctx, tid, envID); cerr != nil {
		return nil, cerr
	}
	return svc.Signatures.GetCertificate(ctx, tid, envID)
}
