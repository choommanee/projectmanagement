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

type PayslipStore struct{ p *pgxpool.Pool }

func NewPayslipStore(p *pgxpool.Pool) *PayslipStore { return &PayslipStore{p: p} }

const payslipSelect = `
    SELECT id, tenant_id, employee_id, period_start, period_end,
           base_salary, allowances, deductions, net_pay, currency,
           status, approved_by, approved_at, paid_at, created_at, updated_at
    FROM payslip`

func scanPayslip(row interface{ Scan(...any) error }, ps *domain.Payslip) error {
	return row.Scan(
		&ps.ID, &ps.TenantID, &ps.EmployeeID,
		&ps.PeriodStart, &ps.PeriodEnd,
		&ps.BaseSalary, &ps.Allowances, &ps.Deductions, &ps.NetPay,
		&ps.Currency, &ps.Status,
		&ps.ApprovedBy, &ps.ApprovedAt, &ps.PaidAt,
		&ps.CreatedAt, &ps.UpdatedAt,
	)
}

func (s *PayslipStore) Create(ctx context.Context, tid uuid.UUID, inp domain.CreatePayslipInput) (domain.Payslip, error) {
	id := uuid.New()
	now := time.Now()
	currency := inp.Currency
	if currency == "" {
		currency = "THB"
	}
	var ps domain.Payslip
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO payslip(id, tenant_id, employee_id, period_start, period_end,
			                    base_salary, allowances, deductions, currency, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
			id, tid, inp.EmployeeID,
			inp.PeriodStart.UTC().Format("2006-01-02"),
			inp.PeriodEnd.UTC().Format("2006-01-02"),
			inp.BaseSalary, inp.Allowances, inp.Deductions,
			currency, now,
		)
		if err != nil {
			return err
		}
		return scanPayslip(tx.QueryRow(ctx, payslipSelect+" WHERE id=$1", id), &ps)
	})
	return ps, err
}

func (s *PayslipStore) GetByID(ctx context.Context, tid, id uuid.UUID) (domain.Payslip, error) {
	var ps domain.Payslip
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanPayslip(tx.QueryRow(ctx, payslipSelect+" WHERE id=$1", id), &ps)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Payslip{}, domain.ErrNotFound
	}
	return ps, err
}

func (s *PayslipStore) List(ctx context.Context, tid uuid.UUID, employeeID *uuid.UUID, status *domain.PayslipStatus, limit, offset int) ([]domain.Payslip, int, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if employeeID != nil {
		where = append(where, fmt.Sprintf("employee_id = $%d", idx))
		args = append(args, *employeeID)
		idx++
	}
	if status != nil {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, string(*status))
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []domain.Payslip
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			payslipSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, limit, offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var ps domain.Payslip
			if err := scanPayslip(rows, &ps); err != nil {
				return err
			}
			items = append(items, ps)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM payslip WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

func (s *PayslipStore) UpdateStatus(ctx context.Context, tid, id uuid.UUID, status domain.PayslipStatus, approvedBy *uuid.UUID) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		var q string
		var args []any
		now := time.Now()
		switch status {
		case domain.PayslipApproved:
			q = `UPDATE payslip SET status=$3, approved_by=$4, approved_at=$5, updated_at=$5 WHERE id=$1 AND tenant_id=$2`
			args = []any{id, tid, string(status), approvedBy, now}
		case domain.PayslipPaid:
			q = `UPDATE payslip SET status=$3, paid_at=$4, updated_at=$4 WHERE id=$1 AND tenant_id=$2`
			args = []any{id, tid, string(status), now}
		default:
			q = `UPDATE payslip SET status=$3, updated_at=$4 WHERE id=$1 AND tenant_id=$2`
			args = []any{id, tid, string(status), now}
		}
		ct, err := tx.Exec(ctx, q, args...)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}
