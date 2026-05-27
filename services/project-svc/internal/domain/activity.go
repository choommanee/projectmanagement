package domain

import "time"

type TaskComment struct {
	ID        string    `json:"id"`
	TenantID  string    `json:"tenantId"`
	TaskID    string    `json:"taskId"`
	AuthorID  string    `json:"authorId"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type TaskActivity struct {
	ID        string    `json:"id"`
	TenantID  string    `json:"tenantId"`
	TaskID    string    `json:"taskId"`
	ActorID   string    `json:"actorId,omitempty"`
	Kind      string    `json:"kind"`
	OldValue  string    `json:"oldValue,omitempty"`
	NewValue  string    `json:"newValue,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}
