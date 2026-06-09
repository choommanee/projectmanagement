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

// ---- Chart of Account ----

type ChartOfAccount struct {
	ID          uuid.UUID
	TenantID    uuid.UUID
	Code        string
	Name        string
	AccountType string
	Currency    string
	Active      bool
	CreatedAt   time.Time
	UpdatedAt   time.Time
	Version     int
}

// ---- Journal Entry ----

type JEStatus string

const (
	JEStatusDraft    JEStatus = "draft"
	JEStatusPosted   JEStatus = "posted"
	JEStatusReversed JEStatus = "reversed"
)

type JournalEntry struct {
	ID        uuid.UUID
	TenantID  uuid.UUID
	RefNo     string
	Memo      string
	Status    JEStatus
	EntryDate time.Time
	PostedAt  *time.Time
	CreatedBy uuid.UUID
	CreatedAt time.Time
	UpdatedAt time.Time
	Version   int
	Lines     []*JournalLine `json:"lines,omitempty"`
}

// ---- Journal Line ----

type JournalLine struct {
	ID          uuid.UUID
	TenantID    uuid.UUID
	EntryID     uuid.UUID
	AccountID   uuid.UUID
	Debit       float64
	Credit      float64
	Description string
	LineNo      int
}

// ---- Invoice ----

type InvType string

const (
	InvTypeAR InvType = "ar"
	InvTypeAP InvType = "ap"
)

type InvStatus string

const (
	InvStatusDraft     InvStatus = "draft"
	InvStatusIssued    InvStatus = "issued"
	InvStatusPaid      InvStatus = "paid"
	InvStatusOverdue   InvStatus = "overdue"
	InvStatusCancelled InvStatus = "cancelled"
)

// ---- Account Budget ----

type AccountBudget struct {
	ID        uuid.UUID
	TenantID  uuid.UUID
	AccountID uuid.UUID
	Amount    float64
	CreatedAt time.Time
	UpdatedAt time.Time
}

type Invoice struct {
	ID              uuid.UUID
	TenantID        uuid.UUID
	InvNo           string
	InvType         InvType
	CounterpartyID  *uuid.UUID
	Amount          float64
	Currency        string
	Status          InvStatus
	IssueDate       time.Time
	DueDate         *time.Time
	PaidAt          *time.Time
	RefSOID         *uuid.UUID
	RefPOID         *uuid.UUID
	Notes           string
	CreatedBy       uuid.UUID
	CreatedAt       time.Time
	UpdatedAt       time.Time
	Version         int
}
