package domain

import "time"

type TaskComment struct {
	ID        string    `json:"id"`
	TenantID  string    `json:"tenant_id"`
	TaskID    string    `json:"task_id"`
	AuthorID  string    `json:"author_id"`
	Body      string    `json:"body"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type TaskActivity struct {
	ID        string    `json:"id"`
	TenantID  string    `json:"tenant_id"`
	TaskID    string    `json:"task_id"`
	ActorID   string    `json:"actor_id,omitempty"`
	Kind      string    `json:"kind"`
	OldValue  string    `json:"old_value,omitempty"`
	NewValue  string    `json:"new_value,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}
