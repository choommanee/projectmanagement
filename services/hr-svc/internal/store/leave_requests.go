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

type LeaveRequestStore struct{ p *pgxpool.Pool }

func NewLeaveRequestStore(p *pgxpool.Pool) *LeaveRequestStore { return &LeaveRequestStore{p: p} }

const leaveSelect = `
    SELECT id, tenant_id, employee_id, leave_type,
           start_date, end_date, days,
           reason, status,
           approved_by, approved_at, rejected_reason,
           created_at, updated_at
    FROM leave_request`

func scanLeaveRequest(row interface{ Scan(...any) error }, lr *domain.LeaveRequest) error {
	return row.Scan(
		&lr.ID, &lr.TenantID, &lr.EmployeeID, &lr.LeaveType,
		&lr.StartDate, &lr.EndDate, &lr.Days,
		&lr.Reason, &lr.Status,
		&lr.ApprovedBy, &lr.ApprovedAt, &lr.RejectedReason,
		&lr.CreatedAt, &lr.UpdatedAt,
	)
}

func (s *LeaveRequestStore) Create(ctx context.Context, tid uuid.UUID, inp domain.CreateLeaveInput) (domain.LeaveRequest, error) {
	id := uuid.New()
	now := time.Now()
	var lr domain.LeaveRequest
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO leave_request(id, tenant_id, employee_id, leave_type,
			                          start_date, end_date, reason, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
			id, tid, inp.EmployeeID, string(inp.LeaveType),
			inp.StartDate.UTC().Format("2006-01-02"),
			inp.EndDate.UTC().Format("2006-01-02"),
			inp.Reason, now,
		)
		if err != nil {
			return err
		}
		return scanLeaveRequest(tx.QueryRow(ctx, leaveSelect+" WHERE id=$1", id), &lr)
	})
	return lr, err
}

func (s *LeaveRequestStore) GetByID(ctx context.Context, tid, id uuid.UUID) (domain.LeaveRequest, error) {
	var lr domain.LeaveRequest
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanLeaveRequest(tx.QueryRow(ctx, leaveSelect+" WHERE id=$1", id), &lr)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.LeaveRequest{}, domain.ErrNotFound
	}
	return lr, err
}

func (s *LeaveRequestStore) List(ctx context.Context, tid uuid.UUID, employeeID *uuid.UUID, status *domain.LeaveStatus, limit, offset int) ([]domain.LeaveRequest, int, error) {
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

	var items []domain.LeaveRequest
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			leaveSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, limit, offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var lr domain.LeaveRequest
			if err := scanLeaveRequest(rows, &lr); err != nil {
				return err
			}
			items = append(items, lr)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM leave_request WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

func (s *LeaveRequestStore) UpdateStatus(ctx context.Context, tid, id uuid.UUID, status domain.LeaveStatus, approvedBy *uuid.UUID, rejectedReason string) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		var q string
		var args []any
		now := time.Now()
		switch status {
		case domain.LeaveApproved:
			q = `UPDATE leave_request SET status=$3, approved_by=$4, approved_at=$5, updated_at=$5 WHERE id=$1 AND tenant_id=$2`
			args = []any{id, tid, string(status), approvedBy, now}
		case domain.LeaveRejected:
			q = `UPDATE leave_request SET status=$3, rejected_reason=$4, updated_at=$5 WHERE id=$1 AND tenant_id=$2`
			args = []any{id, tid, string(status), rejectedReason, now}
		default:
			q = `UPDATE leave_request SET status=$3, updated_at=$4 WHERE id=$1 AND tenant_id=$2`
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
