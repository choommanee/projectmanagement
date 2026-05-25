package store

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/project-svc/internal/domain"
)

type Sprints struct{ p *pgxpool.Pool }

func NewSprints(p *pgxpool.Pool) *Sprints { return &Sprints{p: p} }

func (s *Sprints) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

func (s *Sprints) Create(ctx context.Context, sp *domain.Sprint) error {
	return s.withTenant(ctx, sp.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO sprint(id, tenant_id, project_id, name, goal, status, start_date, end_date, capacity_pts, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			sp.ID, sp.TenantID, sp.ProjectID, sp.Name, sp.Goal, sp.Status, sp.StartDate, sp.EndDate, sp.CapacityPts, sp.Version)
		return err
	})
}

func (s *Sprints) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Sprint, error) {
	var sp domain.Sprint
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `
			SELECT id, tenant_id, project_id, name, COALESCE(goal,''), status, start_date, end_date, capacity_pts, created_at, updated_at, version
			FROM sprint WHERE id = $1`, id)
		var startDate, endDate *time.Time
		if err := row.Scan(&sp.ID, &sp.TenantID, &sp.ProjectID, &sp.Name, &sp.Goal, &sp.Status,
			&startDate, &endDate, &sp.CapacityPts, &sp.CreatedAt, &sp.UpdatedAt, &sp.Version); err != nil {
			return err
		}
		sp.StartDate = startDate
		sp.EndDate = endDate
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &sp, nil
}

func (s *Sprints) List(ctx context.Context, tid, projectID uuid.UUID) ([]*domain.Sprint, error) {
	var items []*domain.Sprint
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, project_id, name, COALESCE(goal,''), status, start_date, end_date, capacity_pts, created_at, updated_at, version
			FROM sprint WHERE project_id = $1 ORDER BY start_date DESC NULLS LAST`, projectID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var sp domain.Sprint
			var startDate, endDate *time.Time
			if err := rows.Scan(&sp.ID, &sp.TenantID, &sp.ProjectID, &sp.Name, &sp.Goal, &sp.Status,
				&startDate, &endDate, &sp.CapacityPts, &sp.CreatedAt, &sp.UpdatedAt, &sp.Version); err != nil {
				return err
			}
			sp.StartDate = startDate
			sp.EndDate = endDate
			items = append(items, &sp)
		}
		return rows.Err()
	})
	return items, err
}

func (s *Sprints) Update(ctx context.Context, sp *domain.Sprint) error {
	return s.withTenant(ctx, sp.TenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE sprint SET name=$3, goal=$4, status=$5, start_date=$6, end_date=$7, capacity_pts=$8,
			  updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$9`,
			sp.ID, sp.TenantID, sp.Name, sp.Goal, sp.Status, sp.StartDate, sp.EndDate, sp.CapacityPts, sp.Version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		sp.Version++
		return nil
	})
}

func (s *Sprints) Delete(ctx context.Context, tid, id uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `DELETE FROM sprint WHERE id=$1 AND tenant_id=$2`, id, tid)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}

func (s *Sprints) AssignTask(ctx context.Context, tid, sprintID, taskID uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "INSERT INTO sprint_task(sprint_id, task_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", sprintID, taskID)
		return err
	})
}

func (s *Sprints) UnassignTask(ctx context.Context, tid, sprintID, taskID uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "DELETE FROM sprint_task WHERE sprint_id=$1 AND task_id=$2", sprintID, taskID)
		return err
	})
}

func (s *Sprints) Tasks(ctx context.Context, tid, sprintID uuid.UUID) ([]*domain.Task, error) {
	var items []*domain.Task
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT t.id, t.tenant_id, t.project_id, t.parent_id, t.code, t.title, COALESCE(t.description,''),
			  t.type, t.status, t.priority, t.assignee_id, t.reviewer_id, t.estimate_md, t.actual_md, t.progress_pct,
			  t.start_date, t.due_date, t.sort_order, t.tags, t.created_at, t.updated_at, t.version
			FROM task t
			JOIN sprint_task st ON st.task_id = t.id
			WHERE st.sprint_id = $1 AND t.deleted_at IS NULL
			ORDER BY t.status, t.sort_order`, sprintID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var t domain.Task
			var startDate, dueDate *time.Time
			if err := rows.Scan(
				&t.ID, &t.TenantID, &t.ProjectID, &t.ParentID, &t.Code, &t.Title, &t.Description,
				&t.Type, &t.Status, &t.Priority, &t.AssigneeID, &t.ReviewerID, &t.EstimateMd, &t.ActualMd, &t.ProgressPct,
				&startDate, &dueDate, &t.SortOrder, &t.Tags, &t.CreatedAt, &t.UpdatedAt, &t.Version,
			); err != nil {
				return err
			}
			t.StartDate = startDate
			t.DueDate = dueDate
			items = append(items, &t)
		}
		return rows.Err()
	})
	return items, err
}
