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

// ---- Quotation ----

type QuotationStatus string

const (
	QuotationDraft    QuotationStatus = "draft"
	QuotationSent     QuotationStatus = "sent"
	QuotationAccepted QuotationStatus = "accepted"
	QuotationRejected QuotationStatus = "rejected"
	QuotationExpired  QuotationStatus = "expired"
)

type Quotation struct {
	ID          uuid.UUID
	TenantID    uuid.UUID
	Code        string
	CustomerID  uuid.UUID
	Title       string
	ValidUntil  *time.Time
	Status      QuotationStatus
	TotalAmount float64
	Notes       string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	Version     int
}

// ---- SalesInvoice ----

type InvoiceStatus string

const (
	InvoiceDraft     InvoiceStatus = "draft"
	InvoiceSent      InvoiceStatus = "sent"
	InvoicePaid      InvoiceStatus = "paid"
	InvoiceOverdue   InvoiceStatus = "overdue"
	InvoiceCancelled InvoiceStatus = "cancelled"
)

type SalesInvoice struct {
	ID         uuid.UUID
	TenantID   uuid.UUID
	Code       string
	SOID       *uuid.UUID
	CustomerID uuid.UUID
	IssueDate  time.Time
	DueDate    *time.Time
	Status     InvoiceStatus
	Subtotal   float64
	Tax        float64
	Total      float64
	Notes      string
	CreatedAt  time.Time
	UpdatedAt  time.Time
	Version    int
}

// ---- Shipment ----

type ShipmentStatus string

const (
	ShipmentPending   ShipmentStatus = "pending"
	ShipmentPacked    ShipmentStatus = "packed"
	ShipmentShipped   ShipmentStatus = "shipped"
	ShipmentDelivered ShipmentStatus = "delivered"
	ShipmentReturned  ShipmentStatus = "returned"
)

type Shipment struct {
	ID              uuid.UUID
	TenantID        uuid.UUID
	Code            string
	SOID            *uuid.UUID
	CustomerID      *uuid.UUID
	ShipDate        *time.Time
	Carrier         string
	TrackingNo      string
	DeliveryAddress string
	Status          ShipmentStatus
	Notes           string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// ---- Opportunity ----

type OpportunityStage string

const (
	StageProspect    OpportunityStage = "prospect"
	StageQualified   OpportunityStage = "qualified"
	StageProposal    OpportunityStage = "proposal"
	StageNegotiation OpportunityStage = "negotiation"
	StageWon         OpportunityStage = "won"
	StageLost        OpportunityStage = "lost"
)

type Opportunity struct {
	ID                uuid.UUID
	TenantID          uuid.UUID
	Title             string
	CustomerID        uuid.UUID
	Stage             OpportunityStage
	Value             float64
	Currency          string
	ExpectedCloseDate *time.Time
	Probability       int
	AssignedTo        *uuid.UUID
	Notes             string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}
