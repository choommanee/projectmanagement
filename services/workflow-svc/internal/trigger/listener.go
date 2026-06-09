package trigger

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go"
	"github.com/pmplatform/services/workflow-svc/internal/service"
	"github.com/rs/zerolog/log"
)

// Listener subscribes to NATS events and fires matching workflow triggers.
type Listener struct {
	svc  *service.Service
	nc   *nats.Conn
	subs []*nats.Subscription
}

var watchedSubjects = []string{
	"project.created",
	"project.updated",
	"task.assigned",
	"task.blocked",
	"document.sign_requested",
	"wo.released",
	"instance.completed",
}

func New(svc *service.Service, nc *nats.Conn) *Listener {
	return &Listener{svc: svc, nc: nc}
}

// AttachService sets the service after construction (used when listener is
// created before the service is fully wired).
func (l *Listener) AttachService(svc *service.Service) { l.svc = svc }

// signatureOutcomes maps a document-svc signature event subject to the
// signature_outcome value injected into the resumed instance's input.
var signatureOutcomes = map[string]string{
	"document.sign_completed": "signed",
	"document.sign_declined":  "declined",
}

// signaturePayload is the document-svc event body for signed/declined events.
type signaturePayload struct {
	TenantID   string `json:"tenant_id"`
	EnvelopeID string `json:"envelope_id"`
	DocumentID string `json:"document_id"`
	Reason     string `json:"reason,omitempty"`
}

// Start subscribes to all watched subjects. Call Stop to unsubscribe.
func (l *Listener) Start(ctx context.Context) {
	for _, subj := range watchedSubjects {
		subj := subj
		sub, err := l.nc.Subscribe(subj, func(msg *nats.Msg) {
			var payload map[string]any
			_ = json.Unmarshal(msg.Data, &payload)
			if err := l.svc.FireEventTriggers(ctx, subj, payload); err != nil {
				log.Warn().Err(err).Str("event", subj).Msg("workflow event trigger failed")
			}
		})
		if err != nil {
			log.Warn().Err(err).Str("subject", subj).Msg("workflow trigger subscribe failed")
			continue
		}
		l.subs = append(l.subs, sub)
	}

	// Signature-outcome events resume a SPECIFIC paused instance (correlated by
	// envelope id) rather than starting new instances — a distinct path from
	// FireEventTriggers.
	for subj, outcome := range signatureOutcomes {
		subj, outcome := subj, outcome
		sub, err := l.nc.Subscribe(subj, func(msg *nats.Msg) {
			l.handleSignatureEvent(ctx, subj, outcome, msg.Data)
		})
		if err != nil {
			log.Warn().Err(err).Str("subject", subj).Msg("workflow signature subscribe failed")
			continue
		}
		l.subs = append(l.subs, sub)
	}

	log.Info().Int("subjects", len(l.subs)).Msg("workflow event trigger listener started")
}

// handleSignatureEvent correlates a document-svc signed/declined event to the
// paused instance awaiting that envelope and resumes it with the outcome.
func (l *Listener) handleSignatureEvent(ctx context.Context, subj, outcome string, data []byte) {
	var p signaturePayload
	if err := json.Unmarshal(data, &p); err != nil {
		log.Warn().Err(err).Str("event", subj).Msg("signature event: bad payload")
		return
	}
	tid, err := uuid.Parse(p.TenantID)
	if err != nil {
		log.Warn().Err(err).Str("event", subj).Str("tenant_id", p.TenantID).
			Msg("signature event: invalid tenant_id")
		return
	}
	env, err := uuid.Parse(p.EnvelopeID)
	if err != nil {
		log.Warn().Err(err).Str("event", subj).Str("envelope_id", p.EnvelopeID).
			Msg("signature event: invalid envelope_id")
		return
	}
	if _, err := l.svc.ResumeBySignature(ctx, tid, env, outcome); err != nil {
		log.Warn().Err(err).Str("event", subj).Str("envelope_id", p.EnvelopeID).
			Msg("signature event: resume failed")
	}
}

// Stop drains all subscriptions.
func (l *Listener) Stop() {
	for _, sub := range l.subs {
		_ = sub.Unsubscribe()
	}
}
