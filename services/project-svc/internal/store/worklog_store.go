package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/project-svc/internal/domain"
)

type WorklogStore struct{ p *pgxpool.Pool }

func NewWorklogStore(p *pgxpool.Pool) *WorklogStore { return &WorklogStore{p: p} }

func (s *WorklogStore) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

// List returns all worklog entries for a task, ordered by work_date DESC.
func (s *WorklogStore) List(ctx context.Context, tenantID, taskID uuid.UUID) ([]domain.WorklogEntry, error) {
	var out []domain.WorklogEntry
	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT id, tenant_id, task_id, user_id, logged_md, work_date, note, created_at
			 FROM task_worklog WHERE task_id = $1 ORDER BY work_date DESC, created_at DESC`,
			taskID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var e domain.WorklogEntry
			if err := rows.Scan(&e.ID, &e.TenantID, &e.TaskID, &e.UserID,
				&e.LoggedMd, &e.WorkDate, &e.Note, &e.CreatedAt); err != nil {
				return err
			}
			out = append(out, e)
		}
		return rows.Err()
	})
	return out, err
}

// Create inserts a new worklog entry and returns the persisted record.
func (s *WorklogStore) Create(ctx context.Context, tenantID uuid.UUID, p domain.CreateWorklogParams) (domain.WorklogEntry, error) {
	var e domain.WorklogEntry
	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`INSERT INTO task_worklog (tenant_id, task_id, user_id, logged_md, work_date, note)
			 VALUES ($1,$2,$3,$4,$5,$6)
			 RETURNING id, tenant_id, task_id, user_id, logged_md, work_date, note, created_at`,
			tenantID, p.TaskID, p.UserID, p.LoggedMd, p.WorkDate, p.Note,
		).Scan(&e.ID, &e.TenantID, &e.TaskID, &e.UserID, &e.LoggedMd, &e.WorkDate, &e.Note, &e.CreatedAt)
	})
	return e, err
}

// Delete removes a worklog entry by ID.
func (s *WorklogStore) Delete(ctx context.Context, tenantID, id uuid.UUID) error {
	return s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `DELETE FROM task_worklog WHERE id = $1`, id)
		return err
	})
}
