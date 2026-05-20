package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/workflow-svc/internal/domain"
)

type HumanTasks struct{ p *pgxpool.Pool }

func NewHumanTasks(p *pgxpool.Pool) *HumanTasks { return &HumanTasks{p: p} }

func (s *HumanTasks) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
	return (&Definitions{p: s.p}).withTenant(ctx, tid, fn)
}

type ListHumanTasksOpts struct {
	AssigneeID *uuid.UUID
	InstanceID *uuid.UUID
	Status     string // "open" | "completed"
	Limit      int
	Offset     int
}

func (s *HumanTasks) List(ctx context.Context, tid uuid.UUID, opts ListHumanTasksOpts) ([]*domain.HumanTask, int, error) {
	if opts.Limit <= 0 || opts.Limit > 200 {
		opts.Limit = 50
	}
	where := "tenant_id = $1"
	args := []any{tid}
	idx := 2

	if opts.AssigneeID != nil {
		where += fmt.Sprintf(" AND assignee_id = $%d", idx)
		args = append(args, *opts.AssigneeID)
		idx++
	}
	if opts.InstanceID != nil {
		where += fmt.Sprintf(" AND instance_id = $%d", idx)
		args = append(args, *opts.InstanceID)
		idx++
	}
	if opts.Status == "open" {
		where += " AND completed_at IS NULL"
	} else if opts.Status == "completed" {
		where += " AND completed_at IS NOT NULL"
	}

	var items []*domain.HumanTask
	var total int
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			htSelect+" WHERE "+where+
				fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var ht domain.HumanTask
			if err := scanHT(rows, &ht); err != nil {
				return err
			}
			items = append(items, &ht)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM human_task WHERE "+where, args...).Scan(&total)
	})
	return items, total, err
}

func (s *HumanTasks) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.HumanTask, error) {
	var ht domain.HumanTask
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return scanHT(tx.QueryRow(ctx, htSelect+" WHERE id=$1 AND tenant_id=$2", id, tid), &ht)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &ht, nil
}

// Complete sets outcome + completed_at and returns the updated task.
func (s *HumanTasks) Complete(ctx context.Context, tid, id uuid.UUID, outcome string, data json.RawMessage) (*domain.HumanTask, error) {
	var ht domain.HumanTask
	now := time.Now()
	return &ht, s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE human_task SET outcome=$3, data=$4, completed_at=$5
			WHERE id=$1 AND tenant_id=$2 AND completed_at IS NULL`,
			id, tid, outcome, data, now)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return scanHT(tx.QueryRow(ctx, htSelect+" WHERE id=$1 AND tenant_id=$2", id, tid), &ht)
	})
}

const htSelect = `
    SELECT id, tenant_id, instance_id, step_id, assignee_id, form, data,
           outcome, sla_deadline, escalate_to, created_at, completed_at
    FROM human_task`

func scanHT(r rowScanner, ht *domain.HumanTask) error {
	return r.Scan(
		&ht.ID, &ht.TenantID, &ht.InstanceID, &ht.StepID, &ht.AssigneeID, &ht.Form, &ht.Data,
		&ht.Outcome, &ht.SLADeadline, &ht.EscalateTo, &ht.CreatedAt, &ht.CompletedAt)
}
