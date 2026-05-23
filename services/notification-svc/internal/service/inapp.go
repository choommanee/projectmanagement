package service

import (
	"context"

	"github.com/google/uuid"

	notiflib "github.com/pmplatform/libs/go/notification"
	"github.com/pmplatform/services/notification-svc/internal/store"
)

// InAppChannel persists notification events to the notification table.
type InAppChannel struct {
	store *store.Store
}

// NewInAppChannel creates a new InAppChannel backed by the given store.
func NewInAppChannel(s *store.Store) *InAppChannel {
	return &InAppChannel{store: s}
}

// Name returns the channel identifier used for preference matching.
func (c *InAppChannel) Name() string { return "inapp" }

// Send persists the notification event as a row in the notification table.
func (c *InAppChannel) Send(ctx context.Context, ev notiflib.Event) error {
	tid, err := uuid.Parse(ev.TenantID)
	if err != nil {
		return err
	}
	uid, err := uuid.Parse(ev.UserID)
	if err != nil {
		return err
	}
	_, err = c.store.Insert(ctx, store.InsertParams{
		ID:       ev.ID,
		TenantID: tid,
		UserID:   uid,
		Kind:     ev.Kind,
		Title:    ev.Title,
		Body:     ev.Body,
		Payload:  ev.Payload,
	})
	return err
}
