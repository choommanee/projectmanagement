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

// ---- Payroll ----

type PayslipStatus string

const (
	PayslipDraft    PayslipStatus = "draft"
	PayslipApproved PayslipStatus = "approved"
	PayslipPaid     PayslipStatus = "paid"
)

type PayGrade struct {
	ID        uuid.UUID `json:"id"`
	TenantID  uuid.UUID `json:"tenant_id"`
	Name      string    `json:"name"`
	MinSalary float64   `json:"min_salary"`
	MaxSalary float64   `json:"max_salary"`
	Currency  string    `json:"currency"`
	CreatedAt time.Time `json:"created_at"`
}

type Payslip struct {
	ID          uuid.UUID     `json:"id"`
	TenantID    uuid.UUID     `json:"tenant_id"`
	EmployeeID  uuid.UUID     `json:"employee_id"`
	PeriodStart time.Time     `json:"period_start"`
	PeriodEnd   time.Time     `json:"period_end"`
	BaseSalary  float64       `json:"base_salary"`
	Allowances  float64       `json:"allowances"`
	Deductions  float64       `json:"deductions"`
	NetPay      float64       `json:"net_pay"`
	Currency    string        `json:"currency"`
	Status      PayslipStatus `json:"status"`
	ApprovedBy  *uuid.UUID    `json:"approved_by,omitempty"`
	ApprovedAt  *time.Time    `json:"approved_at,omitempty"`
	PaidAt      *time.Time    `json:"paid_at,omitempty"`
	CreatedAt   time.Time     `json:"created_at"`
	UpdatedAt   time.Time     `json:"updated_at"`
}

type CreatePayslipInput struct {
	EmployeeID  uuid.UUID `json:"employee_id"`
	PeriodStart time.Time `json:"period_start"`
	PeriodEnd   time.Time `json:"period_end"`
	BaseSalary  float64   `json:"base_salary"`
	Allowances  float64   `json:"allowances"`
	Deductions  float64   `json:"deductions"`
	Currency    string    `json:"currency"`
}
