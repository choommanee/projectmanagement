package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/hr-svc/internal/domain"
)

type EmployeeStore struct{ p *pgxpool.Pool }

func NewEmployeeStore(p *pgxpool.Pool) *EmployeeStore { return &EmployeeStore{p: p} }

const empSelect = `
    SELECT id, tenant_id, emp_no, first_name, last_name, email, phone,
           department_id, position_id, status, hire_date, termination_date,
           created_at, updated_at, version
    FROM employee`

func scanEmp(row interface{ Scan(...any) error }, e *domain.Employee) error {
	return row.Scan(
		&e.ID, &e.TenantID, &e.EmpNo, &e.FirstName, &e.LastName,
		&e.Email, &e.Phone, &e.DepartmentID, &e.PositionID,
		&e.Status, &e.HireDate, &e.TerminationDate,
		&e.CreatedAt, &e.UpdatedAt, &e.Version,
	)
}

func (s *EmployeeStore) Create(ctx context.Context, e *domain.Employee) error {
	e.ID = uuid.New()
	e.CreatedAt = time.Now()
	e.UpdatedAt = e.CreatedAt
	e.Version = 1
	if e.Status == "" {
		e.Status = domain.EmpStatusActive
	}
	return withTenant(ctx, s.p, e.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO employee(id, tenant_id, emp_no, first_name, last_name, email, phone,
			                     department_id, position_id, status, hire_date, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			e.ID, e.TenantID, e.EmpNo, e.FirstName, e.LastName, e.Email, e.Phone,
			e.DepartmentID, e.PositionID, e.Status, e.HireDate, e.Version,
		)
		return err
	})
}

func (s *EmployeeStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Employee, error) {
	var e domain.Employee
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanEmp(tx.QueryRow(ctx, empSelect+" WHERE id=$1", id), &e)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

type ListEmployeeOpts struct {
	Query        string
	DepartmentID *uuid.UUID
	Status       string
	Limit        int
	Offset       int
}

func (s *EmployeeStore) List(ctx context.Context, tid uuid.UUID, opts ListEmployeeOpts) ([]*domain.Employee, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if opts.Query != "" {
		where = append(where, fmt.Sprintf(
			"(emp_no ILIKE $%d OR first_name ILIKE $%d OR last_name ILIKE $%d)",
			idx, idx, idx,
		))
		args = append(args, "%"+opts.Query+"%")
		idx++
	}
	if opts.DepartmentID != nil {
		where = append(where, fmt.Sprintf("department_id = $%d", idx))
		args = append(args, *opts.DepartmentID)
		idx++
	}
	if opts.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, opts.Status)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.Employee
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			empSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY emp_no ASC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var e domain.Employee
			if err := scanEmp(rows, &e); err != nil {
				return err
			}
			items = append(items, &e)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM employee WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdateEmployeeInput struct {
	FirstName    string
	LastName     string
	Email        string
	Phone        string
	DepartmentID *uuid.UUID
	PositionID   *uuid.UUID
	Status       domain.EmpStatus
	Version      int
}

func (s *EmployeeStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdateEmployeeInput) (*domain.Employee, error) {
	var e domain.Employee
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE employee
			SET first_name=$3, last_name=$4, email=$5, phone=$6,
			    department_id=$7, position_id=$8, status=$9,
			    updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$10`,
			id, tid, in.FirstName, in.LastName, in.Email, in.Phone,
			in.DepartmentID, in.PositionID, in.Status, in.Version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return scanEmp(tx.QueryRow(ctx, empSelect+" WHERE id=$1", id), &e)
	})
	if errors.Is(err, domain.ErrConflict) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// Terminate sets the employee status to terminated and records the termination date.
func (s *EmployeeStore) Terminate(ctx context.Context, tid, id uuid.UUID, terminationDate time.Time, version int) (*domain.Employee, error) {
	var e domain.Employee
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE employee
			SET status='terminated', termination_date=$3, updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$4`,
			id, tid, terminationDate, version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return scanEmp(tx.QueryRow(ctx, empSelect+" WHERE id=$1", id), &e)
	})
	if errors.Is(err, domain.ErrConflict) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}
