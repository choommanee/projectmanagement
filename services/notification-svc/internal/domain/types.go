package domain

import "time"

// Notification represents one row of the notification table.
type Notification struct {
	ID        string         `json:"id"`
	TenantID  string         `json:"tenant_id"`
	UserID    string         `json:"user_id"`
	Kind      string         `json:"kind"`
	Title     string         `json:"title"`
	Body      string         `json:"body,omitempty"`
	Payload   map[string]any `json:"payload,omitempty"`
	ReadAt    *time.Time     `json:"read_at,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
}
