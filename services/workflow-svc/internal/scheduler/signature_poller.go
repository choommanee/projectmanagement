package scheduler

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/pmplatform/services/workflow-svc/internal/docsvc"
	"github.com/pmplatform/services/workflow-svc/internal/service"
	"github.com/pmplatform/services/workflow-svc/internal/store"
)

// Dual-path signature resume design:
//
//   - NATS (instant path): trigger.Listener consumes document.sign_completed /
//     document.sign_declined and calls svc.ResumeBySignature immediately.
//   - SignaturePoller (fallback path): on boxes without a nats-server the events
//     never arrive, so this loop periodically reads each paused instance's
//     envelope status directly from document-svc and resumes accordingly.
//
// Both paths funnel through ResumeBySignature, which calls FindPausedByEnvelope
// (status='paused' AND pending_envelope_id=$envelope) and returns (nil, nil)
// when no such instance exists. The first path to win flips the instance out of
// 'paused' and/or clears pending_envelope_id, so the loser's FindPausedByEnvelope
// finds nothing and no-ops. That makes the dual paths idempotent — neither
// double-resumes nor thrashes the same instance.

// SignatureMinter is the subset of serviceauth.Client the signature poller
// needs to authenticate to document-svc.
type SignatureMinter interface {
	TokenFor(ctx context.Context, tenantID string) (string, error)
}

// docClient is the subset of docsvc.Client the poller depends on (interface so
// tests can point at an httptest server).
type docClient interface {
	GetEnvelope(ctx context.Context, token, tenantID string, envelopeID uuid.UUID) (*docsvc.Envelope, error)
}

// SignaturePoller periodically resumes paused instances whose signature
// envelope has reached a terminal state in document-svc, as a NATS-free
// fallback for the request_signature step.
type SignaturePoller struct {
	svc       *service.Service
	instances *store.Instances
	doc       docClient
	auth      SignatureMinter
	interval  time.Duration
	batch     int
	stop      chan struct{}
	done      chan struct{}
}

// NewSignaturePoller constructs a SignaturePoller. interval<=0 defaults to 30s.
// auth may be nil (degraded local dev) — the document-svc request then carries
// no bearer token.
func NewSignaturePoller(svc *service.Service, instances *store.Instances, doc docClient, auth SignatureMinter, interval time.Duration) *SignaturePoller {
	if interval <= 0 {
		interval = 30 * time.Second
	}
	return &SignaturePoller{
		svc:       svc,
		instances: instances,
		doc:       doc,
		auth:      auth,
		interval:  interval,
		batch:     100,
		stop:      make(chan struct{}),
		done:      make(chan struct{}),
	}
}

// Start launches the poll loop in a goroutine. Call Stop to terminate it.
func (p *SignaturePoller) Start(ctx context.Context) {
	go func() {
		defer close(p.done)
		ticker := time.NewTicker(p.interval)
		defer ticker.Stop()
		log.Info().Dur("interval", p.interval).Msg("workflow signature poller started")
		for {
			select {
			case <-ctx.Done():
				return
			case <-p.stop:
				return
			case <-ticker.C:
				p.RunOnce(ctx)
			}
		}
	}()
}

// Stop signals the loop to terminate and waits for it to finish.
func (p *SignaturePoller) Stop() {
	close(p.stop)
	<-p.done
}

// RunOnce finds all paused instances awaiting a signature envelope, reads each
// envelope's status from document-svc, and resumes those that reached a
// terminal state. Returns the number of instances it resumed. All per-instance
// errors are logged, not fatal — an unreachable document-svc just means nothing
// is resumed this tick and the loop tries again next interval.
func (p *SignaturePoller) RunOnce(ctx context.Context) int {
	pending, err := p.instances.FindPendingSignatures(ctx, p.batch)
	if err != nil {
		log.Warn().Err(err).Msg("signature poller: find pending signatures failed")
		return 0
	}
	resumed := 0
	for _, ps := range pending {
		if p.process(ctx, ps) {
			resumed++
		}
	}
	return resumed
}

// process handles a single pending-signature instance. Returns true if it
// resumed the instance.
func (p *SignaturePoller) process(ctx context.Context, ps store.PendingSignature) bool {
	tenantStr := ps.TenantID.String()

	var token string
	if p.auth != nil {
		if tok, err := p.auth.TokenFor(ctx, tenantStr); err != nil {
			log.Warn().Err(err).Str("tenant_id", tenantStr).
				Msg("signature poller: token mint failed — querying document-svc without auth")
		} else {
			token = tok
		}
	}

	env, err := p.doc.GetEnvelope(ctx, token, tenantStr, ps.EnvelopeID)
	if err != nil {
		// 404 / network / non-200: skip (safest). NATS may still deliver, and the
		// next tick retries. We deliberately do NOT fail the instance here.
		log.Warn().Err(err).
			Str("envelope_id", ps.EnvelopeID.String()).
			Str("instance", ps.InstanceID.String()).
			Msg("signature poller: get envelope failed — skipping")
		return false
	}

	var outcome string
	switch env.Status {
	case "completed":
		outcome = "signed"
	case "declined", "voided", "expired":
		outcome = "declined"
	default:
		// draft/sent/active — still awaiting signature; leave it paused.
		return false
	}

	// ResumeBySignature is idempotent vs. the NATS path (see file header). If the
	// NATS event already resumed this instance, FindPausedByEnvelope finds nothing
	// and this is a harmless no-op (res == nil).
	res, err := p.svc.ResumeBySignature(ctx, ps.TenantID, ps.EnvelopeID, outcome)
	if err != nil {
		log.Warn().Err(err).
			Str("envelope_id", ps.EnvelopeID.String()).
			Str("instance", ps.InstanceID.String()).
			Msg("signature poller: resume failed")
		return false
	}
	if res == nil {
		// Already resumed by another path between the SELECT and now.
		return false
	}
	log.Info().
		Str("envelope_id", ps.EnvelopeID.String()).
		Str("instance", ps.InstanceID.String()).
		Str("outcome", outcome).
		Msg("signature poller: resumed instance from envelope status")
	return true
}
