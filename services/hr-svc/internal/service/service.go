package service

import (
	"github.com/pmplatform/services/hr-svc/internal/store"
)

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
