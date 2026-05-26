package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

var (
	ErrNotFound     = errors.New("not found")
	ErrConflict     = errors.New("version conflict")
	ErrInvalidInput = errors.New("invalid input")
)

// ---- Customer ----

type Customer struct {
	ID             uuid.UUID
	TenantID       uuid.UUID
	Code           string
	Name           string
	Contact        string
	Email          string
	Phone          string
	BillingAddress string
	Active         bool
	CreatedAt      time.Time
	UpdatedAt      time.Time
	Version        int
}

// ---- Sales Order ----

type SOStatus string

const (
	SOStatusDraft     SOStatus = "draft"
	SOStatusConfirmed SOStatus = "confirmed"
	SOStatusShipped   SOStatus = "shipped"
	SOStatusInvoiced  SOStatus = "invoiced"
	SOStatusCancelled SOStatus = "cancelled"
)

type SalesOrder struct {
	ID            uuid.UUID
	TenantID      uuid.UUID
	SONumber      string
	CustomerID    uuid.UUID
	Status        SOStatus
	OrderDate     time.Time
	RequestedDate *time.Time
	Notes         string
	CreatedBy     uuid.UUID
	CreatedAt     time.Time
	UpdatedAt     time.Time
	Version       int
	Lines         []*SOLine `json:"lines,omitempty"`
}

// ---- SO Line ----

type SOLine struct {
	ID         uuid.UUID
	TenantID   uuid.UUID
	SOID       uuid.UUID
	ItemID     *uuid.UUID
	ItemDesc   string
	LineNo     int
	QtyOrdered float64
	QtyShipped float64
	UnitPrice  float64
	Notes      string
}
