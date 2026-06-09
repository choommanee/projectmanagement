package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/pmplatform/libs/go/audit"
	"github.com/pmplatform/services/hr-svc/internal/domain"
	"github.com/pmplatform/services/hr-svc/internal/store"
)

// AuditPublisher is satisfied by *audit.PgPublisher and *audit.Fallback.
type AuditPublisher interface {
	Publish(ctx context.Context, action string, ev audit.Event) error
}

// Service aggregates all HR domain stores.
type Service struct {
	Departments        *store.DepartmentStore
	Positions          *store.PositionStore
	Employees          *store.EmployeeStore
	Payslips           *store.PayslipStore
	LeaveRequests      *store.LeaveRequestStore
	Training           *store.TrainingStore
	Jobs               *store.JobStore
	PerformanceReviews *store.PerformanceReviewStore
	PayrollRuns        *store.PayrollRunStore

	// Audit records significant mutations to audit_log. Optional: nil makes
	// the audit helper a no-op.
	Audit AuditPublisher
}

// WithAudit attaches an audit publisher and returns the service for chaining.
func (s *Service) WithAudit(p AuditPublisher) *Service {
	s.Audit = p
	return s
}

func New(
	depts *store.DepartmentStore,
	positions *store.PositionStore,
	employees *store.EmployeeStore,
	payslips *store.PayslipStore,
	leaveRequests *store.LeaveRequestStore,
	training *store.TrainingStore,
	jobs *store.JobStore,
	performanceReviews *store.PerformanceReviewStore,
	payrollRuns *store.PayrollRunStore,
) *Service {
	return &Service{
		Departments:        depts,
		Positions:          positions,
		Employees:          employees,
		Payslips:           payslips,
		LeaveRequests:      leaveRequests,
		Training:           training,
		Jobs:               jobs,
		PerformanceReviews: performanceReviews,
		PayrollRuns:        payrollRuns,
	}
}

func (s *Service) UpdateTraining(ctx context.Context, tid, id uuid.UUID, in store.UpdateTrainingInput) (*domain.Training, error) {
	return s.Training.Update(ctx, tid, id, in)
}

func (s *Service) UpdateJob(ctx context.Context, tid, id uuid.UUID, in store.UpdateJobInput) (*domain.JobPosting, error) {
	return s.Jobs.Update(ctx, tid, id, in)
}

func (s *Service) UpdatePerformanceReview(ctx context.Context, tid, id uuid.UUID, in store.UpdateReviewInput) (*domain.PerformanceReview, error) {
	return s.PerformanceReviews.Update(ctx, tid, id, in)
}

func (s *Service) UpdatePayrollRun(ctx context.Context, tid, id uuid.UUID, in store.UpdatePayrollRunInput) (*domain.PayrollRun, error) {
	return s.PayrollRuns.Update(ctx, tid, id, in)
}
