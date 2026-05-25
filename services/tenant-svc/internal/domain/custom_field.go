package domain

import (
	"time"

	"github.com/google/uuid"
)

// FieldType enumerates the supported custom field value types.
type FieldType string

const (
	FieldText     FieldType = "text"
	FieldNumber   FieldType = "number"
	FieldDate     FieldType = "date"
	FieldDropdown FieldType = "dropdown"
	FieldUser     FieldType = "user"
	FieldBoolean  FieldType = "boolean"
)

// CustomFieldDef is the domain entity for a per-tenant EAV field definition.
type CustomFieldDef struct {
	ID         uuid.UUID
	TenantID   uuid.UUID
	EntityType string
	FieldKey   string
	Label      string
	FieldType  FieldType
	Options    []string // non-nil for dropdown type; empty otherwise
	Required   bool
	SortOrder  int
	CreatedAt  time.Time
}

// CreateCustomFieldParams holds validated input for creating a new definition.
type CreateCustomFieldParams struct {
	EntityType string
	FieldKey   string
	Label      string
	FieldType  FieldType
	Options    []string
	Required   bool
	SortOrder  int
}
