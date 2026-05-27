package trigger

import (
	"context"
	"encoding/json"

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
	log.Info().Int("subjects", len(l.subs)).Msg("workflow event trigger listener started")
}

// Stop drains all subscriptions.
func (l *Listener) Stop() {
	for _, sub := range l.subs {
		_ = sub.Unsubscribe()
	}
}
