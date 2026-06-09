package domain

import (
	"time"

	"github.com/google/uuid"
)

// Supplier is a vendor/supplier master record.
type Supplier struct {
	ID           uuid.UUID
	TenantID     uuid.UUID
	Code         string
	Name         string
	Contact      string
	Email        string
	Phone        string
	LeadTimeDays int
	Active       bool
	CreatedAt    time.Time
	UpdatedAt    time.Time
	Version      int
}

// POStatus enumerates purchase-order lifecycle states.
type POStatus string

const (
	PODraft             POStatus = "draft"
	POSubmitted         POStatus = "submitted"
	POApproved          POStatus = "approved"
	POPartiallyReceived POStatus = "partially_received"
	POReceived          POStatus = "received"
	POCancelled         POStatus = "cancelled"
)

// PurchaseOrder is a procurement order header.
type PurchaseOrder struct {
	ID           uuid.UUID
	TenantID     uuid.UUID
	PONumber     string
	SupplierID   uuid.UUID
	Status       POStatus
	OrderDate    *time.Time
	ExpectedDate *time.Time
	SourceSoID   *uuid.UUID
	Notes        string
	CreatedBy    uuid.UUID
	Lines        []POLine
	CreatedAt    time.Time
	UpdatedAt    time.Time
	Version      int
}

// POLine is one line of a purchase order.
type POLine struct {
	ID          uuid.UUID
	TenantID    uuid.UUID
	POID        uuid.UUID
	ItemID      uuid.UUID
	LineNo      int
	QtyOrdered  float64
	QtyReceived float64
	UnitPrice   float64
	UomID       *uuid.UUID
	Notes       string
}
