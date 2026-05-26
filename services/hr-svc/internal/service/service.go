package service

import (
	"github.com/pmplatform/services/hr-svc/internal/store"
)

// Service aggregates all HR domain stores.
type Service struct {
	Departments *store.DepartmentStore
	Positions   *store.PositionStore
	Employees   *store.EmployeeStore
}

func New(depts *store.DepartmentStore, positions *store.PositionStore, employees *store.EmployeeStore) *Service {
	return &Service{
		Departments: depts,
		Positions:   positions,
		Employees:   employees,
	}
}
