package service

import (
	"github.com/pmplatform/services/hr-svc/internal/store"
)

// Service aggregates all HR domain stores.
type Service struct {
	Departments *store.DepartmentStore
	Positions   *store.PositionStore
	Employees   *store.EmployeeStore
	Payslips    *store.PayslipStore
}

func New(depts *store.DepartmentStore, positions *store.PositionStore, employees *store.EmployeeStore, payslips *store.PayslipStore) *Service {
	return &Service{
		Departments: depts,
		Positions:   positions,
		Employees:   employees,
		Payslips:    payslips,
	}
}
