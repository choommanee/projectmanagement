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

// TaskPatch carries only the fields that a PATCH caller explicitly supplied.
// Nil means "do not change"; a non-nil pointer means "set to this value"
// (including empty string / zero-value, which is how fields get cleared).
// This struct is consumed by Patch which issues a single atomic COALESCE
// UPDATE — no separate read required, no TOCTOU risk.
type TaskPatch struct {
	TenantID    uuid.UUID
	ID          uuid.UUID
	Version     int // current client version (optimistic lock)
	Title       *string
	Description *string
	Type        *string
	Status      *string
	Priority    *string
	AssigneeID  **uuid.UUID // outer nil = don't change; inner nil = clear
	ReviewerID  **uuid.UUID
	EstimateMd  *float64
	ActualMd    *float64
	ProgressPct *int
	SortOrder   *int
	Tags        *[]string
	ParentID    **uuid.UUID
}

// Patch applies only the non-nil fields in p to the task row identified by
// (TenantID, ID, Version). It uses COALESCE so unset fields retain their
// current database values, making it safe against concurrent patches with
// different version numbers. If the row's version does not match p.Version
// it returns domain.ErrConflict (HTTP 409).
func (s *Tasks) Patch(ctx context.Context, p TaskPatch) (*domain.Task, error) {
	var t domain.Task
	err := s.withTenant(ctx, p.TenantID, func(tx pgx.Tx) error {
		// Inline helper: dereference *string -> interface{} (nil when not set)
		strArg := func(v *string) interface{} {
			if v == nil {
				return nil
			}
			return *v
		}
		float64Arg := func(v *float64) interface{} {
			if v == nil {
				return nil
			}
			return *v
		}
		intArg := func(v *int) interface{} {
			if v == nil {
				return nil
			}
			return *v
		}
		// For UUID pointer-of-pointer: outer nil = don't change; outer non-nil =
		// set to inner value (which may itself be nil = clear the FK).
		uuidArg := func(v **uuid.UUID) interface{} {
			if v == nil {
				return nil // COALESCE will keep old value
			}
			return *v // may be nil (clear FK) or a UUID value
		}
		tagsArg := func(v *[]string) interface{} {
			if v == nil {
				return nil
			}
			return *v
		}

		ct, err := tx.Exec(ctx, `
			UPDATE task SET
			  title        = COALESCE($3,  title),
			  description  = COALESCE($4,  description),
			  type         = COALESCE($5,  type),
			  status       = COALESCE($6,  status),
			  priority     = COALESCE($7,  priority),
			  assignee_id  = CASE WHEN $8::uuid IS NOT DISTINCT FROM NULL AND $9 THEN NULL
			                      WHEN $8::uuid IS NOT NULL THEN $8::uuid
			                      ELSE assignee_id END,
			  reviewer_id  = CASE WHEN $10::uuid IS NOT DISTINCT FROM NULL AND $11 THEN NULL
			                      WHEN $10::uuid IS NOT NULL THEN $10::uuid
			                      ELSE reviewer_id END,
			  estimate_md  = COALESCE($12, estimate_md),
			  actual_md    = COALESCE($13, actual_md),
			  progress_pct = COALESCE($14, progress_pct),
			  sort_order   = COALESCE($15, sort_order),
			  tags         = COALESCE($16, tags),
			  parent_id    = CASE WHEN $17::uuid IS NOT DISTINCT FROM NULL AND $18 THEN NULL
			                      WHEN $17::uuid IS NOT NULL THEN $17::uuid
			                      ELSE parent_id END,
			  updated_at   = now(),
			  version      = version + 1
			WHERE id = $1 AND tenant_id = $2 AND version = $19 AND deleted_at IS NULL`,
			p.ID, p.TenantID,
			strArg(p.Title),       // $3
			strArg(p.Description), // $4
			strArg(p.Type),        // $5
			strArg(p.Status),      // $6
			strArg(p.Priority),    // $7
			uuidArg(p.AssigneeID), // $8  uuid value or nil
			p.AssigneeID != nil,   // $9  true = caller wants to set/clear assignee_id
			uuidArg(p.ReviewerID), // $10
			p.ReviewerID != nil,   // $11
			float64Arg(p.EstimateMd),  // $12
			float64Arg(p.ActualMd),    // $13
			intArg(p.ProgressPct),     // $14
			intArg(p.SortOrder),       // $15
			tagsArg(p.Tags),           // $16
			uuidArg(p.ParentID),       // $17
			p.ParentID != nil,         // $18
			p.Version,                 // $19
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return scanTask(tx.QueryRow(ctx, taskSelect+" WHERE id = $1 AND deleted_at IS NULL", p.ID), &t)
	})
	if err != nil {
		return nil, err
	}
	return &t, nil
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

func (s *Tasks) ListDepsForProject(ctx context.Context, tenantID, projectID uuid.UUID) ([]domain.TaskDependency, error) {
	const q = `
		SELECT td.id, td.tenant_id, td.predecessor_id, td.successor_id, td.type, td.lag_days, td.created_at
		FROM task_dependency td
		JOIN task t ON t.id = td.successor_id
		WHERE t.project_id = $1 AND td.tenant_id = $2 AND t.deleted_at IS NULL`
	var out []domain.TaskDependency
	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, q, projectID, tenantID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var d domain.TaskDependency
			if err := rows.Scan(&d.ID, &d.TenantID, &d.PredecessorID, &d.SuccessorID, &d.Type, &d.LagDays, &d.CreatedAt); err != nil {
				return err
			}
			out = append(out, d)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
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
