package worker

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	natsx "github.com/pmplatform/libs/go/nats"
	"github.com/pmplatform/libs/go/notification"

	"github.com/pmplatform/services/notification-svc/internal/store"
)

// StreamName is the JetStream stream backing notif.* subjects.
const StreamName = "NOTIF"

// SubjectFilter is the wildcard subscription pattern.
const SubjectFilter = "notif.>"

// Run subscribes to the notif.> stream and persists each event via the store.
// Blocks until ctx is cancelled.
func Run(ctx context.Context, c *natsx.Client, s *store.Store) error {
	if err := c.EnsureStream(ctx, StreamName, []string{SubjectFilter}); err != nil {
		return err
	}

	cc, err := c.Subscribe(ctx, StreamName, SubjectFilter, func(data []byte) error {
		return Handle(ctx, s, data)
	})
	if err != nil {
		return err
	}
	defer cc.Stop()

	log.Info().Str("subject", SubjectFilter).Msg("notification-svc consuming")
	<-ctx.Done()
	return nil
}

// Handle parses a notification event payload and writes it to the store.
// Exposed for unit testing without NATS.
func Handle(ctx context.Context, s *store.Store, data []byte) error {
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
	tid, err := uuid.Parse(ev.TenantID)
	if err != nil {
		return err
	}
	uid, err := uuid.Parse(ev.UserID)
	if err != nil {
		return err
	}
	_, err = s.Insert(ctx, store.InsertParams{
		ID:       ev.ID,
		TenantID: tid,
		UserID:   uid,
		Kind:     ev.Kind,
		Title:    ev.Title,
		Body:     ev.Body,
		Payload:  ev.Payload,
	})
	if err != nil {
		log.Error().Err(err).Str("kind", ev.Kind).Msg("persist notification")
	}
	return err
}
