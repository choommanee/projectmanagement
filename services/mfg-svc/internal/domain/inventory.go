package domain

import (
	"time"

	"github.com/google/uuid"
)

type TxnType string

const (
	TxnReceive TxnType = "receive"
	TxnIssue   TxnType = "issue"
	TxnAdjust  TxnType = "adjust"
)

type StockBalance struct {
	ID        uuid.UUID
	TenantID  uuid.UUID
	ItemID    uuid.UUID
	LotNumber string
	Location  string
	QtyOnHand float64
	UpdatedAt time.Time
}

type InventoryTransaction struct {
	ID        uuid.UUID
	TenantID  uuid.UUID
	ItemID    uuid.UUID
	LotNumber string
	Location  string
	TxnType   TxnType
	Qty       float64
	RefType   string
	RefID     *uuid.UUID
	Note      string
	CreatedBy uuid.UUID
	CreatedAt time.Time
}

type PostTransactionParams struct {
	ItemID    uuid.UUID
	LotNumber string
	Location  string
	TxnType   TxnType
	Qty       float64
	RefType   string
	RefID     *uuid.UUID
	Note      string
	CreatedBy uuid.UUID
}
