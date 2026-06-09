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

// UOM — unit of measure
type UOM struct {
	ID           uuid.UUID
	TenantID     uuid.UUID
	Code         string
	Name         string
	RatioToBase  float64
}

// ItemType enumerates item kinds.
type ItemType string

const (
	ItemTypeRaw        ItemType = "raw"
	ItemTypeComponent  ItemType = "component"
	ItemTypeAssembly   ItemType = "assembly"
	ItemTypeFinished   ItemType = "finished"
	ItemTypeConsumable ItemType = "consumable"
	ItemTypeService    ItemType = "service"
)

// ItemStatus enumerates lifecycle states.
type ItemStatus string

const (
	ItemStatusActive   ItemStatus = "active"
	ItemStatusInactive ItemStatus = "inactive"
	ItemStatusObsolete ItemStatus = "obsolete"
)

// Item is the master item/part record.
type Item struct {
	ID            uuid.UUID
	TenantID      uuid.UUID
	Code          string
	Name          string
	Description   string
	Type          ItemType
	Status        ItemStatus
	UomID         uuid.UUID
	LotTracked    bool
	SerialTracked bool
	Attrs         map[string]any
	CreatedAt     time.Time
	UpdatedAt     time.Time
	DeletedAt     *time.Time
	Version       int
}

// WCType is work-center type.
type WCType string

const (
	WCTypeMachine WCType = "machine"
	WCTypeLabor   WCType = "labor"
	WCTypeCell    WCType = "cell"
)

// WorkCenter is a production resource.
type WorkCenter struct {
	ID                uuid.UUID
	TenantID          uuid.UUID
	Code              string
	Name              string
	Type              WCType
	CapacityPerDayHrs float64
	MachineCount      int
	Status            ItemStatus
	CreatedAt         time.Time
	UpdatedAt         time.Time
	Version           int
}

// BOMStatus enumerates BOM lifecycle.
type BOMStatus string

const (
	BOMStatusDraft    BOMStatus = "draft"
	BOMStatusActive   BOMStatus = "active"
	BOMStatusObsolete BOMStatus = "obsolete"
)

// BOMHeader is the top-level BOM record.
type BOMHeader struct {
	ID            uuid.UUID
	TenantID      uuid.UUID
	ItemID        uuid.UUID
	Version       int
	IsDefault     bool
	Status        BOMStatus
	EffectiveFrom *time.Time
	EffectiveTo   *time.Time
	Notes         string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// BOMLine is one component row in a BOM.
type BOMLine struct {
	ID             uuid.UUID
	TenantID       uuid.UUID
	HeaderID       uuid.UUID
	ChildItemID    uuid.UUID
	Qty            float64
	UomID          uuid.UUID
	AlternateOfID  *uuid.UUID
	IsPhantom      bool
	ScrapPct       float64
	SortOrder      int
	Notes          string
}

// ExplodeRow is returned by ExplodeMultiLevel.
type ExplodeRow struct {
	Level    int
	ItemID   uuid.UUID
	ItemCode string
	ItemName string
	Qty      float64
	UomCode  string
	ItemType ItemType
}

// RoutingHeader is the top-level routing.
type RoutingHeader struct {
	ID        uuid.UUID
	TenantID  uuid.UUID
	ItemID    uuid.UUID
	Version   int
	IsDefault bool
	Status    BOMStatus
	Notes     string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// RoutingOperation is one operation step.
type RoutingOperation struct {
	ID              uuid.UUID
	TenantID        uuid.UUID
	RoutingID       uuid.UUID
	OpNo            int
	WorkCenterID    uuid.UUID
	SetupMin        float64
	RunPerUnitMin   float64
	Description     string
}

// WOStatus enumerates work-order states.
type WOStatus string

const (
	WOStatusPlanned    WOStatus = "planned"
	WOStatusReleased   WOStatus = "released"
	WOStatusInProgress WOStatus = "in_progress"
	WOStatusCompleted  WOStatus = "completed"
	WOStatusClosed     WOStatus = "closed"
	WOStatusCancelled  WOStatus = "cancelled"
)

// WOPriority enumerates work-order priority.
type WOPriority string

const (
	WOPriorityLow      WOPriority = "low"
	WOPriorityMed      WOPriority = "med"
	WOPriorityHigh     WOPriority = "high"
	WOPriorityCritical WOPriority = "critical"
)

// WorkOrder is a manufacturing order.
type WorkOrder struct {
	ID               uuid.UUID
	TenantID         uuid.UUID
	Code             string
	ItemID           uuid.UUID
	Qty              float64
	QtyCompleted     float64
	Status           WOStatus
	Priority         WOPriority
	DueDate          *time.Time
	WorkCenterID     *uuid.UUID
	StartAt          *time.Time
	EndAt            *time.Time
	RoutingHeaderID  *uuid.UUID
	BOMHeaderID      *uuid.UUID
	SourceSoID       *uuid.UUID
	Notes            string
	CreatedAt        time.Time
	UpdatedAt        time.Time
	DeletedAt        *time.Time
	Version          int
}

// WorkOrderOperation is a snapshotted routing operation on a WO.
type WorkOrderOperation struct {
	ID              uuid.UUID
	TenantID        uuid.UUID
	WorkOrderID     uuid.UUID
	OpNo            int
	WorkCenterID    uuid.UUID
	SetupMin        float64
	RunPerUnitMin   float64
	Description     string
	QtyDone         float64
	Status          WOStatus
}

// WorkOrderMaterial is a snapshotted BOM line on a WO.
type WorkOrderMaterial struct {
	ID           uuid.UUID
	TenantID     uuid.UUID
	WorkOrderID  uuid.UUID
	ItemID       uuid.UUID
	QtyRequired  float64
	QtyIssued    float64
	UomID        uuid.UUID
}

// LotStatus enumerates lot states.
type LotStatus string

const (
	LotStatusReleased    LotStatus = "released"
	LotStatusHold        LotStatus = "hold"
	LotStatusQuarantine  LotStatus = "quarantine"
	LotStatusConsumed    LotStatus = "consumed"
)

// Lot is a tracked quantity batch.
type Lot struct {
	ID          uuid.UUID
	TenantID    uuid.UUID
	ItemID      uuid.UUID
	LotNo       string
	QtyOnHand   float64
	Status      LotStatus
	SourceWOID  *uuid.UUID
	Notes       string
	CreatedAt   time.Time
}

// MrpRun is an MRP calculation run header.
type MrpRun struct {
	ID       uuid.UUID
	TenantID uuid.UUID
	Name     string
	RunAt    time.Time
	Params   map[string]any
	Note     string
}

// MrpSource is the source type for demand/supply.
type MrpSource string

const (
	MrpSourceSales    MrpSource = "sales"
	MrpSourceWO       MrpSource = "wo"
	MrpSourceForecast MrpSource = "forecast"
	MrpSourcePO       MrpSource = "po"
	MrpSourceStock    MrpSource = "stock"
)

// MrpDemand is a demand row in an MRP run.
type MrpDemand struct {
	ID        uuid.UUID
	TenantID  uuid.UUID
	RunID     uuid.UUID
	ItemID    uuid.UUID
	Qty       float64
	DueDate   *time.Time
	Source    MrpSource
	SourceRef string
}

// MrpSupply is a supply row in an MRP run.
type MrpSupply struct {
	ID          uuid.UUID
	TenantID    uuid.UUID
	RunID       uuid.UUID
	ItemID      uuid.UUID
	Qty         float64
	AvailableAt *time.Time
	Source      MrpSource
	SourceRef   string
}

// MrpActionKind is the type of recommended action.
type MrpActionKind string

const (
	MrpActionRelease    MrpActionKind = "release"
	MrpActionReschedule MrpActionKind = "reschedule"
	MrpActionCancel     MrpActionKind = "cancel"
	MrpActionNoop       MrpActionKind = "noop"
)

// MrpAction is a recommended action from an MRP run.
type MrpAction struct {
	ID         uuid.UUID
	TenantID   uuid.UUID
	RunID      uuid.UUID
	Action     MrpActionKind
	EntityType string
	EntityID   *uuid.UUID
	Message    string
}

// MrpRunSummary contains counts for a run.
type MrpRunSummary struct {
	Run     *MrpRun
	Demands int
	Supplies int
	Actions int
}
