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

type PayrollRunStore struct{ p *pgxpool.Pool }

func NewPayrollRunStore(p *pgxpool.Pool) *PayrollRunStore { return &PayrollRunStore{p: p} }

const payrunSelect = `
    SELECT id, tenant_id, period, status,
           total_gross, total_deductions, total_net, employee_count,
           processed_at, created_at, updated_at
    FROM payroll_run`

func scanPayrun(row interface{ Scan(...any) error }, pr *domain.PayrollRun) error {
	return row.Scan(
		&pr.ID, &pr.TenantID, &pr.Period, &pr.Status,
		&pr.TotalGross, &pr.TotalDeductions, &pr.TotalNet, &pr.EmployeeCount,
		&pr.ProcessedAt, &pr.CreatedAt, &pr.UpdatedAt,
	)
}

type ListPayrollRunOpts struct {
	Status string
	Limit  int
	Offset int
}

func (s *PayrollRunStore) List(ctx context.Context, tid uuid.UUID, opts ListPayrollRunOpts) ([]*domain.PayrollRun, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if opts.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, opts.Status)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	items := make([]*domain.PayrollRun, 0)
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			payrunSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var pr domain.PayrollRun
			if err := scanPayrun(rows, &pr); err != nil {
				return err
			}
			items = append(items, &pr)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM payroll_run WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

func (s *PayrollRunStore) Create(ctx context.Context, in domain.CreatePayrollRunInput, tid uuid.UUID) (*domain.PayrollRun, error) {
	pr := &domain.PayrollRun{
		ID:              uuid.New(),
		TenantID:        tid,
		Period:          in.Period,
		Status:          in.Status,
		TotalGross:      in.TotalGross,
		TotalDeductions: in.TotalDeductions,
		TotalNet:        in.TotalNet,
		EmployeeCount:   in.EmployeeCount,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}
	if pr.Status == "" {
		pr.Status = domain.PayrunDraft
	}
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO payroll_run(id, tenant_id, period, status,
			                        total_gross, total_deductions, total_net, employee_count,
			                        created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			pr.ID, pr.TenantID, pr.Period, pr.Status,
			pr.TotalGross, pr.TotalDeductions, pr.TotalNet, pr.EmployeeCount,
			pr.CreatedAt, pr.UpdatedAt,
		)
		return err
	})
	if err != nil {
		return nil, err
	}
	return pr, nil
}

func (s *PayrollRunStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.PayrollRun, error) {
	var pr domain.PayrollRun
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanPayrun(tx.QueryRow(ctx, payrunSelect+" WHERE id=$1", id), &pr)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &pr, nil
}

func (s *PayrollRunStore) UpdateStatus(ctx context.Context, tid, id uuid.UUID, status domain.PayrunStatus) (*domain.PayrollRun, error) {
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			"UPDATE payroll_run SET status=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2",
			id, tid, status,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetByID(ctx, tid, id)
}

type UpdatePayrollRunInput struct {
	Status          *domain.PayrunStatus `json:"status,omitempty"`
	TotalGross      *float64             `json:"total_gross,omitempty"`
	TotalDeductions *float64             `json:"total_deductions,omitempty"`
	TotalNet        *float64             `json:"total_net,omitempty"`
	EmployeeCount   *int                 `json:"employee_count,omitempty"`
}

func (s *PayrollRunStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdatePayrollRunInput) (*domain.PayrollRun, error) {
	sets := []string{}
	args := []any{id, tid}
	idx := 3
	if in.Status != nil {
		sets = append(sets, fmt.Sprintf("status=$%d", idx))
		args = append(args, *in.Status)
		idx++
	}
	if in.TotalGross != nil {
		sets = append(sets, fmt.Sprintf("total_gross=$%d", idx))
		args = append(args, *in.TotalGross)
		idx++
	}
	if in.TotalDeductions != nil {
		sets = append(sets, fmt.Sprintf("total_deductions=$%d", idx))
		args = append(args, *in.TotalDeductions)
		idx++
	}
	if in.TotalNet != nil {
		sets = append(sets, fmt.Sprintf("total_net=$%d", idx))
		args = append(args, *in.TotalNet)
		idx++
	}
	if in.EmployeeCount != nil {
		sets = append(sets, fmt.Sprintf("employee_count=$%d", idx))
		args = append(args, *in.EmployeeCount)
		idx++
	}
	if len(sets) == 0 {
		return s.GetByID(ctx, tid, id)
	}
	sets = append(sets, "updated_at=now()")
	sql := "UPDATE payroll_run SET " + strings.Join(sets, ", ") + " WHERE id=$1 AND tenant_id=$2"
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, sql, args...)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetByID(ctx, tid, id)
}
