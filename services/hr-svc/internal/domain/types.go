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
	ID        uuid.UUID  `json:"id"`
	TenantID  uuid.UUID  `json:"tenant_id"`
	Code      string     `json:"code"`
	Name      string     `json:"name"`
	ParentID  *uuid.UUID `json:"parent_id"`
	Active    bool       `json:"active"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	Version   int        `json:"version"`
}

// ---- Position ----

type Position struct {
	ID        uuid.UUID `json:"id"`
	TenantID  uuid.UUID `json:"tenant_id"`
	Code      string    `json:"code"`
	Name      string    `json:"name"`
	Grade     string    `json:"grade"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	Version   int       `json:"version"`
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
	ID              uuid.UUID  `json:"id"`
	TenantID        uuid.UUID  `json:"tenant_id"`
	EmpNo           string     `json:"emp_no"`
	FirstName       string     `json:"first_name"`
	LastName        string     `json:"last_name"`
	Email           string     `json:"email"`
	Phone           string     `json:"phone"`
	DepartmentID    *uuid.UUID `json:"department_id"`
	PositionID      *uuid.UUID `json:"position_id"`
	Status          EmpStatus  `json:"status"`
	HireDate        time.Time  `json:"hire_date"`
	TerminationDate *time.Time `json:"termination_date"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	Version         int        `json:"version"`
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

// ---- Leave ----

type LeaveType   string
type LeaveStatus string

const (
	LeaveAnnual    LeaveType = "annual"
	LeaveSick      LeaveType = "sick"
	LeaveMaternity LeaveType = "maternity"
	LeavePaternity LeaveType = "paternity"
	LeaveUnpaid    LeaveType = "unpaid"
	LeaveOther     LeaveType = "other"
)

const (
	LeavePending   LeaveStatus = "pending"
	LeaveApproved  LeaveStatus = "approved"
	LeaveRejected  LeaveStatus = "rejected"
	LeaveCancelled LeaveStatus = "cancelled"
)

type LeaveRequest struct {
	ID             uuid.UUID   `json:"id"`
	TenantID       uuid.UUID   `json:"tenant_id"`
	EmployeeID     uuid.UUID   `json:"employee_id"`
	LeaveType      LeaveType   `json:"leave_type"`
	StartDate      time.Time   `json:"start_date"`
	EndDate        time.Time   `json:"end_date"`
	Days           int         `json:"days"`
	Reason         string      `json:"reason,omitempty"`
	Status         LeaveStatus `json:"status"`
	ApprovedBy     *uuid.UUID  `json:"approved_by,omitempty"`
	ApprovedAt     *time.Time  `json:"approved_at,omitempty"`
	RejectedReason string      `json:"rejected_reason,omitempty"`
	CreatedAt      time.Time   `json:"created_at"`
	UpdatedAt      time.Time   `json:"updated_at"`
}

type CreateLeaveInput struct {
	EmployeeID uuid.UUID `json:"employee_id"`
	LeaveType  LeaveType `json:"leave_type"`
	StartDate  time.Time `json:"start_date"`
	EndDate    time.Time `json:"end_date"`
	Reason     string    `json:"reason,omitempty"`
}

// ---- Training ----

type TrainingStatus string

const (
	TrainingPlanned   TrainingStatus = "planned"
	TrainingActive    TrainingStatus = "active"
	TrainingCompleted TrainingStatus = "completed"
	TrainingCancelled TrainingStatus = "cancelled"
)

type Training struct {
	ID              uuid.UUID      `json:"id"`
	TenantID        uuid.UUID      `json:"tenant_id"`
	Title           string         `json:"title"`
	Description     string         `json:"description"`
	Trainer         string         `json:"trainer"`
	Location        string         `json:"location"`
	StartDate       *time.Time     `json:"start_date,omitempty"`
	EndDate         *time.Time     `json:"end_date,omitempty"`
	Status          TrainingStatus `json:"status"`
	MaxParticipants int            `json:"max_participants"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
}

type CreateTrainingInput struct {
	Title           string         `json:"title"`
	Description     string         `json:"description"`
	Trainer         string         `json:"trainer"`
	Location        string         `json:"location"`
	StartDate       *time.Time     `json:"start_date,omitempty"`
	EndDate         *time.Time     `json:"end_date,omitempty"`
	Status          TrainingStatus `json:"status,omitempty"`
	MaxParticipants int            `json:"max_participants"`
}

// ---- Job Posting / Recruitment ----

type JobStatus string

const (
	JobDraft     JobStatus = "draft"
	JobOpen      JobStatus = "open"
	JobClosed    JobStatus = "closed"
	JobCancelled JobStatus = "cancelled"
)

type JobPosting struct {
	ID           uuid.UUID  `json:"id"`
	TenantID     uuid.UUID  `json:"tenant_id"`
	Title        string     `json:"title"`
	DepartmentID *uuid.UUID `json:"department_id,omitempty"`
	Description  string     `json:"description"`
	Requirements string     `json:"requirements"`
	SalaryMin    *float64   `json:"salary_min,omitempty"`
	SalaryMax    *float64   `json:"salary_max,omitempty"`
	Status       JobStatus  `json:"status"`
	PostedDate   *time.Time `json:"posted_date,omitempty"`
	ClosesDate   *time.Time `json:"closes_date,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type CreateJobPostingInput struct {
	Title        string     `json:"title"`
	DepartmentID *uuid.UUID `json:"department_id,omitempty"`
	Description  string     `json:"description"`
	Requirements string     `json:"requirements"`
	SalaryMin    *float64   `json:"salary_min,omitempty"`
	SalaryMax    *float64   `json:"salary_max,omitempty"`
	Status       JobStatus  `json:"status,omitempty"`
	PostedDate   *time.Time `json:"posted_date,omitempty"`
	ClosesDate   *time.Time `json:"closes_date,omitempty"`
}

type ApplicantStatus string

const (
	ApplicantApplied    ApplicantStatus = "applied"
	ApplicantScreening  ApplicantStatus = "screening"
	ApplicantInterview  ApplicantStatus = "interview"
	ApplicantOffer      ApplicantStatus = "offer"
	ApplicantHired      ApplicantStatus = "hired"
	ApplicantRejected   ApplicantStatus = "rejected"
)

type Applicant struct {
	ID        uuid.UUID       `json:"id"`
	TenantID  uuid.UUID       `json:"tenant_id"`
	JobID     uuid.UUID       `json:"job_id"`
	Name      string          `json:"name"`
	Email     string          `json:"email"`
	Phone     string          `json:"phone"`
	Status    ApplicantStatus `json:"status"`
	ResumeURL string          `json:"resume_url"`
	Notes     string          `json:"notes"`
	AppliedAt time.Time       `json:"applied_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

type CreateApplicantInput struct {
	JobID     uuid.UUID `json:"job_id"`
	Name      string    `json:"name"`
	Email     string    `json:"email,omitempty"`
	Phone     string    `json:"phone,omitempty"`
	ResumeURL string    `json:"resume_url,omitempty"`
	Notes     string    `json:"notes,omitempty"`
}

// ---- Performance Review ----

type ReviewStatus string

const (
	ReviewDraft         ReviewStatus = "draft"
	ReviewSelfReview    ReviewStatus = "self_review"
	ReviewManagerReview ReviewStatus = "manager_review"
	ReviewCompleted     ReviewStatus = "completed"
)

type PerformanceReview struct {
	ID              uuid.UUID    `json:"id"`
	TenantID        uuid.UUID    `json:"tenant_id"`
	EmployeeID      uuid.UUID    `json:"employee_id"`
	ReviewPeriod    string       `json:"review_period"`
	Status          ReviewStatus `json:"status"`
	OverallRating   *int         `json:"overall_rating,omitempty"`
	SelfComments    string       `json:"self_comments"`
	ManagerComments string       `json:"manager_comments"`
	CreatedAt       time.Time    `json:"created_at"`
	UpdatedAt       time.Time    `json:"updated_at"`
}

type CreateReviewInput struct {
	EmployeeID      uuid.UUID    `json:"employee_id"`
	ReviewPeriod    string       `json:"review_period"`
	Status          ReviewStatus `json:"status,omitempty"`
	OverallRating   *int         `json:"overall_rating,omitempty"`
	SelfComments    string       `json:"self_comments,omitempty"`
	ManagerComments string       `json:"manager_comments,omitempty"`
}

// ---- Payroll Run ----

type PayrunStatus string

const (
	PayrunDraft      PayrunStatus = "draft"
	PayrunProcessing PayrunStatus = "processing"
	PayrunCompleted  PayrunStatus = "completed"
	PayrunCancelled  PayrunStatus = "cancelled"
)

type PayrollRun struct {
	ID               uuid.UUID    `json:"id"`
	TenantID         uuid.UUID    `json:"tenant_id"`
	Period           string       `json:"period"`
	Status           PayrunStatus `json:"status"`
	TotalGross       float64      `json:"total_gross"`
	TotalDeductions  float64      `json:"total_deductions"`
	TotalNet         float64      `json:"total_net"`
	EmployeeCount    int          `json:"employee_count"`
	ProcessedAt      *time.Time   `json:"processed_at,omitempty"`
	CreatedAt        time.Time    `json:"created_at"`
	UpdatedAt        time.Time    `json:"updated_at"`
}

type CreatePayrollRunInput struct {
	Period          string       `json:"period"`
	Status          PayrunStatus `json:"status,omitempty"`
	TotalGross      float64      `json:"total_gross"`
	TotalDeductions float64      `json:"total_deductions"`
	TotalNet        float64      `json:"total_net"`
	EmployeeCount   int          `json:"employee_count"`
}
