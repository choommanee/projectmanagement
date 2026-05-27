package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/project-svc/internal/domain"
)

// ActivityStore handles reads and writes for task_comment and task_activity.
type ActivityStore struct{ p *pgxpool.Pool }

func NewActivity(pool *pgxpool.Pool) *ActivityStore { return &ActivityStore{p: pool} }

// withTenant begins a transaction and sets app.current_tenant for RLS.
func (s *ActivityStore) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
	tx, err := s.p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String())); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ListComments returns all comments for a task in ascending chronological order.
func (s *ActivityStore) ListComments(ctx context.Context, tenantID, taskID uuid.UUID) ([]domain.TaskComment, error) {
	var out []domain.TaskComment
	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT id, tenant_id, task_id, author_id, body, created_at, updated_at
             FROM task_comment
             WHERE task_id = $1
             ORDER BY created_at ASC`, taskID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c domain.TaskComment
			if err := rows.Scan(&c.ID, &c.TenantID, &c.TaskID, &c.AuthorID, &c.Body, &c.CreatedAt, &c.UpdatedAt); err != nil {
				return err
			}
			out = append(out, c)
		}
		return rows.Err()
	})
	return out, err
}

// CreateComment inserts a new comment and returns the persisted record.
func (s *ActivityStore) CreateComment(ctx context.Context, tenantID, taskID, authorID uuid.UUID, body string) (*domain.TaskComment, error) {
	var c domain.TaskComment
	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`INSERT INTO task_comment (tenant_id, task_id, author_id, body)
             VALUES ($1, $2, $3, $4)
             RETURNING id, tenant_id, task_id, author_id, body, created_at, updated_at`,
			tenantID, taskID, authorID, body,
		).Scan(&c.ID, &c.TenantID, &c.TaskID, &c.AuthorID, &c.Body, &c.CreatedAt, &c.UpdatedAt)
	})
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// ListActivity returns the most recent 100 activity events for a task in
// descending chronological order.
func (s *ActivityStore) ListActivity(ctx context.Context, tenantID, taskID uuid.UUID) ([]domain.TaskActivity, error) {
	var out []domain.TaskActivity
	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT id, tenant_id, task_id, COALESCE(actor_id::text, ''), kind,
                    COALESCE(old_value, ''), COALESCE(new_value, ''), created_at
             FROM task_activity
             WHERE task_id = $1
             ORDER BY created_at DESC
             LIMIT 100`, taskID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a domain.TaskActivity
			if err := rows.Scan(&a.ID, &a.TenantID, &a.TaskID, &a.ActorID, &a.Kind, &a.OldValue, &a.NewValue, &a.CreatedAt); err != nil {
				return err
			}
			out = append(out, a)
		}
		return rows.Err()
	})
	return out, err
}

// RecordActivity inserts a single activity event. actorID may be nil for
// system-generated events.
func (s *ActivityStore) RecordActivity(ctx context.Context, tenantID, taskID uuid.UUID, actorID *uuid.UUID, kind, oldVal, newVal string) error {
	return s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`INSERT INTO task_activity (tenant_id, task_id, actor_id, kind, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
			tenantID, taskID, actorID, kind, oldVal, newVal)
		return err
	})
}
