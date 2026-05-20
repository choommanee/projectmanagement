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

// ---- APQP ----

type APQPPhase string

const (
	APQPPhaseConcept    APQPPhase = "concept"
	APQPPhaseDesign     APQPPhase = "design"
	APQPPhaseProcess    APQPPhase = "process"
	APQPPhaseValidation APQPPhase = "validation"
	APQPPhaseProduction APQPPhase = "production"
	APQPPhaseFeedback   APQPPhase = "feedback"
)

type APQPStatus string

const (
	APQPStatusNotStarted APQPStatus = "not_started"
	APQPStatusInProgress APQPStatus = "in_progress"
	APQPStatusComplete   APQPStatus = "complete"
	APQPStatusBlocked    APQPStatus = "blocked"
)

type APQPProject struct {
	ID           uuid.UUID
	TenantID     uuid.UUID
	ItemID       *uuid.UUID
	WorkOrderID  *uuid.UUID
	Name         string
	Phase        APQPPhase
	Status       APQPStatus
	Milestones   []byte // raw JSON
	OwnerID      *uuid.UUID
	TargetDate   *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
	Version      int
}

// ---- PPAP ----

type PPAPStatus string

const (
	PPAPStatusDraft     PPAPStatus = "draft"
	PPAPStatusSubmitted PPAPStatus = "submitted"
	PPAPStatusApproved  PPAPStatus = "approved"
	PPAPStatusRejected  PPAPStatus = "rejected"
	PPAPStatusInterim   PPAPStatus = "interim"
)

type PPAPElementStatus string

const (
	PPAPElemNotRequired   PPAPElementStatus = "not_required"
	PPAPElemInProgress    PPAPElementStatus = "in_progress"
	PPAPElemComplete      PPAPElementStatus = "complete"
	PPAPElemNotApplicable PPAPElementStatus = "not_applicable"
)

type PPAPSubmission struct {
	ID          uuid.UUID
	TenantID    uuid.UUID
	ItemID      uuid.UUID
	PartNo      string
	Customer    string
	Level       int
	Status      PPAPStatus
	SubmittedAt *time.Time
	DecisionAt  *time.Time
	Notes       string
	CreatedAt   time.Time
	UpdatedAt   time.Time
	Version     int
}

type PPAPElement struct {
	ID           uuid.UUID
	TenantID     uuid.UUID
	SubmissionID uuid.UUID
	ElementNo    int
	Name         string
	Status       PPAPElementStatus
	EvidenceURL  string
	Notes        string
	UpdatedAt    time.Time
}

var PPAPElementNames = [18]string{
	"Design Records",
	"Engineering Change Documents",
	"Customer Engineering Approval",
	"Design FMEA",
	"Process Flow Diagrams",
	"Process FMEA",
	"Control Plan",
	"Measurement System Analysis Studies",
	"Dimensional Results",
	"Records of Material/Performance Tests",
	"Initial Process Studies",
	"Qualified Laboratory Documentation",
	"Appearance Approval Report",
	"Sample Production Parts",
	"Master Sample",
	"Checking Aids",
	"Customer-Specific Requirements",
	"Part Submission Warrant (PSW)",
}

// ---- FMEA ----

type FMEAType string

const (
	FMEATypePFMEA FMEAType = "pfmea"
	FMEATypeDFMEA FMEAType = "dfmea"
)

type FMEA struct {
	ID        uuid.UUID
	TenantID  uuid.UUID
	Type      FMEAType
	ItemID    *uuid.UUID
	Name      string
	Team      []string
	Status    APQPStatus
	CreatedAt time.Time
	UpdatedAt time.Time
	Version   int
}

type FMEAFailureMode struct {
	ID          uuid.UUID
	TenantID    uuid.UUID
	FMEAID      uuid.UUID
	Function    string
	FailureMode string
	Effect      string
	Severity    int
	Cause       string
	Occurrence  int
	Detection   int
	RPN         int // computed by Postgres
	Actions     string
	TargetDate  *time.Time
	SortOrder   int
}

// ---- Control Plan ----

type ControlPlan struct {
	ID        uuid.UUID
	TenantID  uuid.UUID
	ItemID    uuid.UUID
	Name      string
	Status    APQPStatus
	Version   int
	Notes     string
	CreatedAt time.Time
	UpdatedAt time.Time
}

type ControlPlanCharacteristic struct {
	ID                uuid.UUID
	TenantID          uuid.UUID
	ControlPlanID     uuid.UUID
	No                int
	Characteristic    string
	Spec              string
	SampleSize        string
	SampleFreq        string
	MeasurementMethod string
	ReactionPlan      string
	SortOrder         int
}

// ---- Inspection ----

type InspectionResult string

const (
	InspectionPass InspectionResult = "pass"
	InspectionFail InspectionResult = "fail"
	InspectionHold InspectionResult = "hold"
)

type Inspection struct {
	ID           uuid.UUID
	TenantID     uuid.UUID
	WorkOrderID  *uuid.UUID
	ItemID       uuid.UUID
	LotID        *uuid.UUID
	InspectedAt  time.Time
	Inspector    string
	Result       InspectionResult
	Measurements []byte // raw JSON
	Notes        string
}

// ---- Nonconformance ----

type NCRStatus string

const (
	NCRStatusOpen          NCRStatus = "open"
	NCRStatusInvestigating NCRStatus = "investigating"
	NCRStatusCorrected     NCRStatus = "corrected"
	NCRStatusClosed        NCRStatus = "closed"
)

type Nonconformance struct {
	ID           uuid.UUID
	TenantID     uuid.UUID
	ItemID       uuid.UUID
	LotID        *uuid.UUID
	WorkOrderID  *uuid.UUID
	Qty          float64
	Severity     int
	Description  string
	Status       NCRStatus
	CreatedAt    time.Time
	UpdatedAt    time.Time
	Version      int
}

// ---- CAPA ----

type CAPA struct {
	ID                uuid.UUID
	TenantID          uuid.UUID
	NonconformanceID  uuid.UUID
	RootCause         string
	Action            string
	OwnerID           *uuid.UUID
	TargetDate        *time.Time
	Status            APQPStatus
	Evidence          string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}
