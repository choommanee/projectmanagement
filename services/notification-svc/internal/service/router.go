package service

import (
	"context"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	notiflib "github.com/pmplatform/libs/go/notification"
	"github.com/pmplatform/services/notification-svc/internal/store"
)

// Router resolves per-user channel preferences and fans out notification
// delivery to the matching Channel implementations.
type Router struct {
	prefs    *store.PreferenceStore
	channels map[string]Channel
	log      zerolog.Logger
}

// NewRouter constructs a Router with the given preference store and channel set.
func NewRouter(prefs *store.PreferenceStore, channels ...Channel) *Router {
	m := make(map[string]Channel, len(channels))
	for _, ch := range channels {
		m[ch.Name()] = ch
	}
	return &Router{
		prefs:    prefs,
		channels: m,
		log:      zerolog.Nop(),
	}
}

// WithLogger sets the logger on the Router (optional; defaults to nop).
func (r *Router) WithLogger(log zerolog.Logger) *Router {
	r.log = log
	return r
}

// Route resolves the user's channel preferences for ev.Kind, then calls Send
// on each matching Channel. Channel errors are logged but do not abort
// delivery to other channels.
func (r *Router) Route(ctx context.Context, ev notiflib.Event) error {
	tid, err := uuid.Parse(ev.TenantID)
	if err != nil {
		return err
	}
	uid, err := uuid.Parse(ev.UserID)
	if err != nil {
		return err
	}

	names, err := r.prefs.Get(ctx, tid, uid, ev.Kind)
	if err != nil {
		return err
	}

	for _, name := range names {
		ch, ok := r.channels[name]
		if !ok {
			r.log.Warn().Str("channel", name).Str("kind", ev.Kind).Msg("router: unknown channel, skipping")
			continue
		}
		if sendErr := ch.Send(ctx, ev); sendErr != nil {
			r.log.Error().Err(sendErr).Str("channel", name).Str("kind", ev.Kind).Msg("router: channel send failed")
		}
	}
	return nil
}
