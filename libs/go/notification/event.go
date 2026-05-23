// Package notification provides the shared event schema and publisher helper
// used by every service that needs to emit a user-facing notification.
//
// Events are published on NATS subjects of the form "notif.<kind>" (or any
// subject under "notif.>"). notification-svc consumes the wildcard and
// persists each event to the notification table.
package notification

import "time"

// Event is the canonical notification payload exchanged over NATS and
// persisted by notification-svc.
type Event struct {
	// ID is optional on publish; the publisher will assign one if empty.
	ID string `json:"id,omitempty"`
	// Timestamp is optional on publish; defaults to time.Now().UTC().
	Timestamp time.Time `json:"ts"`
	// TenantID is required — used for RLS isolation.
	TenantID string `json:"tenant_id"`
	// UserID is required — the recipient.
	UserID string `json:"user_id"`
	// Kind is a short type tag (e.g. "task.assigned", "wo.released").
	Kind string `json:"kind"`
	// Title is the short headline shown in the notification center.
	Title string `json:"title"`
	// Body is the optional longer description.
	Body string `json:"body,omitempty"`
	// Payload carries arbitrary structured context (entity refs, deep links, etc.).
	Payload map[string]any `json:"payload,omitempty"`
}
