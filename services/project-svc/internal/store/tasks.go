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

	"github.com/pmplatform/services/project-svc/internal/domain"
)

type Tasks struct{ p *pgxpool.Pool }

func NewTasks(p *pgxpool.Pool) *Tasks { return &Tasks{p: p} }

func (s *Tasks) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
	tx, err := s.p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String())); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Tasks) Create(ctx context.Context, t *domain.Task) error {
	return s.withTenant(ctx, t.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO task(id, tenant_id, project_id, parent_id, code, title, description, type, status, priority,
				assignee_id, reviewer_id, estimate_md, actual_md, progress_pct, start_date, due_date, sort_order, tags, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
			t.ID, t.TenantID, t.ProjectID, t.ParentID, t.Code, t.Title, t.Description, t.Type, t.Status, t.Priority,
			t.AssigneeID, t.ReviewerID, t.EstimateMd, t.ActualMd, t.ProgressPct, t.StartDate, t.DueDate, t.SortOrder, t.Tags, t.Version)
		return err
	})
}

func (s *Tasks) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Task, error) {
	var t domain.Task
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return scanTask(tx.QueryRow(ctx, taskSelect+" WHERE id = $1 AND deleted_at IS NULL", id), &t)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

type ListTasksOpts struct {
	ProjectID *uuid.UUID
	Status    string
	Assignee  *uuid.UUID
	Q         string
	Limit     int
	Offset    int
}

func (s *Tasks) List(ctx context.Context, tid uuid.UUID, opts ListTasksOpts) ([]*domain.Task, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	// Start with tenant filter (always applied for defence in depth alongside RLS)
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2

	if opts.ProjectID != nil {
		where = append(where, fmt.Sprintf("project_id = $%d", idx))
		args = append(args, *opts.ProjectID)
		idx++
	}
	if opts.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, opts.Status)
		idx++
	}
	if opts.Assignee != nil {
		where = append(where, fmt.Sprintf("assignee_id = $%d", idx))
		args = append(args, *opts.Assignee)
		idx++
	}
	if opts.Q != "" {
		where = append(where, fmt.Sprintf("(code ILIKE $%d OR title ILIKE $%d)", idx, idx))
		args = append(args, "%"+opts.Q+"%")
		idx++
	}
	whereSQL := " AND " + strings.Join(where, " AND ")

	var items []*domain.Task
	var total int
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			taskSelect+" WHERE deleted_at IS NULL"+whereSQL+
				fmt.Sprintf(" ORDER BY sort_order, created_at LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var t domain.Task
			if err := scanTask(rows, &t); err != nil {
				return err
			}
			items = append(items, &t)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM task WHERE deleted_at IS NULL"+whereSQL, args...).Scan(&total)
	})
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (s *Tasks) Update(ctx context.Context, t *domain.Task) error {
	return s.withTenant(ctx, t.TenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE task SET title=$3, description=$4, type=$5, status=$6, priority=$7,
			  assignee_id=$8, reviewer_id=$9, estimate_md=$10, actual_md=$11, progress_pct=$12,
			  start_date=$13, due_date=$14, sort_order=$15, tags=$16, parent_id=$17,
			  updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$18 AND deleted_at IS NULL`,
			t.ID, t.TenantID, t.Title, t.Description, t.Type, t.Status, t.Priority,
			t.AssigneeID, t.ReviewerID, t.EstimateMd, t.ActualMd, t.ProgressPct,
			t.StartDate, t.DueDate, t.SortOrder, t.Tags, t.ParentID, t.Version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		t.Version++
		return nil
	})
}

func (s *Tasks) SoftDelete(ctx context.Context, tid, id uuid.UUID, version int) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE task SET deleted_at=now(), updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$3 AND deleted_at IS NULL`, id, tid, version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return nil
	})
}

// Dependencies

func (s *Tasks) AddDependency(ctx context.Context, tid uuid.UUID, d *domain.TaskDependency) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO task_dependency(id, tenant_id, predecessor_id, successor_id, type, lag_days)
			VALUES ($1,$2,$3,$4,$5,$6)`, d.ID, tid, d.PredecessorID, d.SuccessorID, d.Type, d.LagDays)
		return err
	})
}

func (s *Tasks) RemoveDependency(ctx context.Context, tid, id uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "DELETE FROM task_dependency WHERE id=$1 AND tenant_id=$2", id, tid)
		return err
	})
}

const taskSelect = `
    SELECT id, tenant_id, project_id, parent_id, code, title, COALESCE(description,''),
      type, status, priority, assignee_id, reviewer_id, estimate_md, actual_md, progress_pct,
      start_date, due_date, sort_order, tags, created_at, updated_at, version
    FROM task`

func scanTask(r rowScanner, t *domain.Task) error {
	var startDate, dueDate *time.Time
	err := r.Scan(&t.ID, &t.TenantID, &t.ProjectID, &t.ParentID, &t.Code, &t.Title, &t.Description,
		&t.Type, &t.Status, &t.Priority, &t.AssigneeID, &t.ReviewerID,
		&t.EstimateMd, &t.ActualMd, &t.ProgressPct,
		&startDate, &dueDate, &t.SortOrder, &t.Tags, &t.CreatedAt, &t.UpdatedAt, &t.Version)
	if err != nil {
		return err
	}
	t.StartDate = startDate
	t.DueDate = dueDate
	return nil
}
