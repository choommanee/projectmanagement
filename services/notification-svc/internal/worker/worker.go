package worker

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/rs/zerolog/log"

	natsx "github.com/pmplatform/libs/go/nats"
	"github.com/pmplatform/libs/go/notification"

	"github.com/pmplatform/services/notification-svc/internal/service"
)

// StreamName is the JetStream stream backing notif.* subjects.
const StreamName = "NOTIF"

// SubjectFilter is the wildcard subscription pattern.
const SubjectFilter = "notif.>"

// Run subscribes to the notif.> stream and routes each event through the
// Router (fan-out to registered channels). Blocks until ctx is cancelled.
func Run(ctx context.Context, c *natsx.Client, router *service.Router) error {
	if err := c.EnsureStream(ctx, StreamName, []string{SubjectFilter}); err != nil {
		return err
	}

	cc, err := c.Subscribe(ctx, StreamName, SubjectFilter, func(data []byte) error {
		return Handle(ctx, router, data)
	})
	if err != nil {
		return err
	}
	defer cc.Stop()

	log.Info().Str("subject", SubjectFilter).Msg("notification-svc consuming")
	<-ctx.Done()
	return nil
}

// Handle parses a notification event payload and routes it through the Router.
// Exposed for unit testing without NATS.
func Handle(ctx context.Context, router *service.Router, data []byte) error {
	var ev notification.Event
	if err := json.Unmarshal(data, &ev); err != nil {
		return err
	}
	if ev.TenantID == "" || ev.UserID == "" {
		return errors.New("worker: tenant_id and user_id required")
	}
	if ev.Kind == "" || ev.Title == "" {
		return errors.New("worker: kind and title required")
	}
	if err := router.Route(ctx, ev); err != nil {
		log.Error().Err(err).Str("kind", ev.Kind).Msg("router: route failed")
		return err
	}
	return nil
}
