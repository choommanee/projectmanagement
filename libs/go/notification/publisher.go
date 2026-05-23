package notification

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"

	natsx "github.com/pmplatform/libs/go/nats"
)

// SubjectPrefix is the root of the notification subject hierarchy.
// notification-svc subscribes to "notif.>".
const SubjectPrefix = "notif"

// Publisher is the interface for emitting notification events. Callers depend
// on this interface; JetStreamPublisher and NoopPublisher are the two concrete
// implementations.
type Publisher interface {
	Publish(ctx context.Context, ev Event) error
}

// NoopPublisher is a Publisher that silently discards every event. Useful in
// tests and local-dev environments where NATS is not available.
type NoopPublisher struct{}

// Publish implements Publisher. It always returns nil.
func (NoopPublisher) Publish(_ context.Context, _ Event) error { return nil }

// JetStreamPublisher publishes notification events to NATS JetStream on the
// "NOTIF" stream (subjects matching "notif.>"). The stream is created
// idempotently on construction.
type JetStreamPublisher struct {
	c *natsx.Client
}

// NewJetStreamPublisher constructs a JetStreamPublisher and ensures the NOTIF
// stream exists. Returns an error if NATS is unavailable or stream creation
// fails.
func NewJetStreamPublisher(c *natsx.Client) (*JetStreamPublisher, error) {
	if c == nil {
		return nil, errors.New("notification: nil nats client")
	}
	ctx := context.Background()
	if err := c.EnsureStream(ctx, "NOTIF", []string{"notif.>"}); err != nil {
		return nil, err
	}
	return &JetStreamPublisher{c: c}, nil
}

// Publish implements Publisher. It assigns ev.ID and ev.Timestamp if zero,
// validates required fields, marshals to JSON, and publishes to
// "notif.<kind>".
func (p *JetStreamPublisher) Publish(ctx context.Context, ev Event) error {
	if ev.TenantID == "" {
		return errors.New("notification: tenant_id required")
	}
	if ev.UserID == "" {
		return errors.New("notification: user_id required")
	}
	if ev.Kind == "" {
		return errors.New("notification: kind required")
	}
	if ev.Title == "" {
		return errors.New("notification: title required")
	}
	if ev.ID == "" {
		ev.ID = uuid.NewString()
	}
	if ev.Timestamp.IsZero() {
		ev.Timestamp = time.Now().UTC()
	}
	data, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	return p.c.Publish(ctx, SubjectPrefix+"."+ev.Kind, data)
}

