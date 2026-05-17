package audit

import "time"

type Event struct {
	ID         string         `json:"id"`
	Timestamp  time.Time      `json:"ts"`
	TenantID   string         `json:"tenant_id"`
	UserID     string         `json:"user_id,omitempty"`
	Service    string         `json:"service"`
	Action     string         `json:"action"`
	EntityType string         `json:"entity_type,omitempty"`
	EntityID   string         `json:"entity_id,omitempty"`
	Before     map[string]any `json:"before,omitempty"`
	After      map[string]any `json:"after,omitempty"`
	IP         string         `json:"ip,omitempty"`
	Result     string         `json:"result"`
	Meta       map[string]any `json:"meta,omitempty"`
}
