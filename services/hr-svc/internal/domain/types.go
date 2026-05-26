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

// ---- Department ----

type Department struct {
	ID        uuid.UUID
	TenantID  uuid.UUID
	Code      string
	Name      string
	ParentID  *uuid.UUID
	Active    bool
	CreatedAt time.Time
	UpdatedAt time.Time
	Version   int
}

// ---- Position ----

type Position struct {
	ID        uuid.UUID
	TenantID  uuid.UUID
	Code      string
	Name      string
	Grade     string
	Active    bool
	CreatedAt time.Time
	UpdatedAt time.Time
	Version   int
}

// ---- Employee ----

type EmpStatus string

const (
	EmpStatusActive     EmpStatus = "active"
	EmpStatusProbation  EmpStatus = "probation"
	EmpStatusResigned   EmpStatus = "resigned"
	EmpStatusTerminated EmpStatus = "terminated"
)

type Employee struct {
	ID              uuid.UUID
	TenantID        uuid.UUID
	EmpNo           string
	FirstName       string
	LastName        string
	Email           string
	Phone           string
	DepartmentID    *uuid.UUID
	PositionID      *uuid.UUID
	Status          EmpStatus
	HireDate        time.Time
	TerminationDate *time.Time
	CreatedAt       time.Time
	UpdatedAt       time.Time
	Version         int
}
