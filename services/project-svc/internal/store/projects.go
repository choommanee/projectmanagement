package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/project-svc/internal/domain"
)

type Projects struct{ p *pgxpool.Pool }

func NewProjects(p *pgxpool.Pool) *Projects { return &Projects{p: p} }

func (s *Projects) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

func (s *Projects) Create(ctx context.Context, p *domain.Project) error {
	settings, _ := json.Marshal(p.Settings)
	return s.withTenant(ctx, p.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO project(id, tenant_id, code, name, description, status, owner_id, start_date, due_date, progress_pct, tags, settings, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
			p.ID, p.TenantID, p.Code, p.Name, p.Description, p.Status, p.OwnerID, p.StartDate, p.DueDate, p.ProgressPct, p.Tags, settings, p.Version)
		return err
	})
}

func (s *Projects) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Project, error) {
	var p domain.Project
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return scanProject(tx.QueryRow(ctx, projectSelect+" WHERE id = $1 AND deleted_at IS NULL", id), &p)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (s *Projects) GetByCode(ctx context.Context, tid uuid.UUID, code string) (*domain.Project, error) {
	var p domain.Project
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return scanProject(tx.QueryRow(ctx, projectSelect+" WHERE code = $1 AND deleted_at IS NULL", code), &p)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &p, nil
}

type ListProjectsOpts struct {
	Q      string
	Status string
	Limit  int
	Offset int
}

func (s *Projects) List(ctx context.Context, tid uuid.UUID, opts ListProjectsOpts) ([]*domain.Project, int, error) {
	if opts.Limit <= 0 || opts.Limit > 200 {
		opts.Limit = 50
	}
	// Start with tenant filter (always applied for defence in depth alongside RLS)
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2

	if opts.Q != "" {
		where = append(where, fmt.Sprintf("(code ILIKE $%d OR name ILIKE $%d)", idx, idx))
		args = append(args, "%"+opts.Q+"%")
		idx++
	}
	if opts.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, opts.Status)
		idx++
	}
	whereSQL := " AND " + strings.Join(where, " AND ")

	var items []*domain.Project
	var total int
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			projectSelect+" WHERE deleted_at IS NULL"+whereSQL+
				fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var p domain.Project
			if err := scanProject(rows, &p); err != nil {
				return err
			}
			items = append(items, &p)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM project WHERE deleted_at IS NULL"+whereSQL, args...).Scan(&total)
	})
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (s *Projects) Update(ctx context.Context, p *domain.Project) error {
	settings, _ := json.Marshal(p.Settings)
	return s.withTenant(ctx, p.TenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE project SET
			  name=$3, description=$4, status=$5, owner_id=$6,
			  start_date=$7, due_date=$8, progress_pct=$9, tags=$10, settings=$11,
			  updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$12 AND deleted_at IS NULL`,
			p.ID, p.TenantID, p.Name, p.Description, p.Status, p.OwnerID,
			p.StartDate, p.DueDate, p.ProgressPct, p.Tags, settings, p.Version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		p.Version++
		return nil
	})
}

func (s *Projects) SoftDelete(ctx context.Context, tid, id uuid.UUID, version int) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE project SET deleted_at=now(), updated_at=now(), version=version+1
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

const projectSelect = `
    SELECT id, tenant_id, code, name, COALESCE(description,''), status, owner_id,
           start_date, due_date, progress_pct, tags, settings, created_at, updated_at, version
    FROM project`

// rowScanner works with both pgx.Row and pgx.Rows since both implement Scan
type rowScanner interface{ Scan(dest ...any) error }

func scanProject(r rowScanner, p *domain.Project) error {
	var settings []byte
	var startDate, dueDate *time.Time
	err := r.Scan(&p.ID, &p.TenantID, &p.Code, &p.Name, &p.Description, &p.Status, &p.OwnerID,
		&startDate, &dueDate, &p.ProgressPct, &p.Tags, &settings, &p.CreatedAt, &p.UpdatedAt, &p.Version)
	if err != nil {
		return err
	}
	p.StartDate = startDate
	p.DueDate = dueDate
	_ = json.Unmarshal(settings, &p.Settings)
	return nil
}
