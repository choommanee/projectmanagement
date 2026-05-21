package domain

import "time"

// Event represents a single audit log entry.
type Event struct {
	ID         string         `json:"id"`
	Timestamp  time.Time      `json:"ts"`
	TenantID   string         `json:"tenant_id"`
	UserID     string         `json:"user_id,omitempty"`
	Service    string         `json:"service"`
	Action     string         `json:"action"`
	EntityType string         `json:"entity_type,omitempty"`
	EntityID   string         `json:"entity_id,omitempty"`
	IP         string         `json:"ip,omitempty"`
	Result     string         `json:"result"`
	Before     map[string]any `json:"before,omitempty"`
	After      map[string]any `json:"after,omitempty"`
	Meta       map[string]any `json:"meta,omitempty"`
}

// Bucket is a single day+service activity count for sparkline data.
type Bucket struct {
	Day     string `json:"day"`     // ISO date e.g. "2026-05-21"
	Service string `json:"service"`
	Count   int    `json:"count"`
}
