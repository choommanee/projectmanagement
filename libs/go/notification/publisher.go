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

// Publish sends a notification event on NATS. It assigns ID / Timestamp if
// missing, validates the required fields, and publishes on
// "notif.<kind>" so notification-svc can persist it.
//
// Callers should pass an already-connected *natsx.Client.
func Publish(ctx context.Context, c *natsx.Client, ev Event) error {
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
	if c == nil {
		return errors.New("notification: nil nats client")
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
	return c.Publish(ctx, SubjectPrefix+"."+ev.Kind, data)
}
