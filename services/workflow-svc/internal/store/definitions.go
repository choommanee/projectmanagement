package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/workflow-svc/internal/domain"
)

type Definitions struct{ p *pgxpool.Pool }

func NewDefinitions(p *pgxpool.Pool) *Definitions { return &Definitions{p: p} }

func (s *Definitions) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

func (s *Definitions) Create(ctx context.Context, d *domain.WorkflowDefinition) error {
	trigger := d.Trigger
	if trigger == nil {
		trigger = json.RawMessage(`{"type":"manual"}`)
	}
	return s.withTenant(ctx, d.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO workflow_definition(id, tenant_id, name, description, trigger, status, current_version, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			d.ID, d.TenantID, d.Name, d.Description, trigger, d.Status, d.CurrentVersion, d.Version)
		return err
	})
}

func (s *Definitions) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.WorkflowDefinition, error) {
	var d domain.WorkflowDefinition
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return scanDef(tx.QueryRow(ctx,
			defSelect+" WHERE id=$1 AND deleted_at IS NULL", id), &d)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

type ListDefsOpts struct {
	Q      string
	Status string
	Limit  int
	Offset int
}

func (s *Definitions) List(ctx context.Context, tid uuid.UUID, opts ListDefsOpts) ([]*domain.WorkflowDefinition, int, error) {
	if opts.Limit <= 0 || opts.Limit > 200 {
		opts.Limit = 50
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2

	if opts.Q != "" {
		where = append(where, fmt.Sprintf("name ILIKE $%d", idx))
		args = append(args, "%"+opts.Q+"%")
		idx++
	}
	if opts.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, opts.Status)
		idx++
	}
	whereSQL := " AND " + strings.Join(where, " AND ")

	var items []*domain.WorkflowDefinition
	var total int
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			defSelect+" WHERE deleted_at IS NULL"+whereSQL+
				fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var d domain.WorkflowDefinition
			if err := scanDef(rows, &d); err != nil {
				return err
			}
			items = append(items, &d)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		return tx.QueryRow(ctx,
			"SELECT count(*) FROM workflow_definition WHERE deleted_at IS NULL"+whereSQL,
			args...).Scan(&total)
	})
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (s *Definitions) Update(ctx context.Context, d *domain.WorkflowDefinition) error {
	trigger := d.Trigger
	if trigger == nil {
		trigger = json.RawMessage(`{"type":"manual"}`)
	}
	return s.withTenant(ctx, d.TenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE workflow_definition SET
			  name=$3, description=$4, trigger=$5, status=$6, current_version=$7,
			  updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$8 AND deleted_at IS NULL`,
			d.ID, d.TenantID, d.Name, d.Description, trigger, d.Status, d.CurrentVersion, d.Version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		d.Version++
		return nil
	})
}

func (s *Definitions) SoftDelete(ctx context.Context, tid, id uuid.UUID, version int) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE workflow_definition SET deleted_at=now(), updated_at=now(), version=version+1
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

// ListByEventTrigger returns all published definitions that have trigger.type="event"
// and trigger.event matching the given subject.
func (s *Definitions) ListByEventTrigger(ctx context.Context, event string) ([]*domain.WorkflowDefinition, error) {
	rows, err := s.p.Query(ctx, `
		SELECT id, tenant_id, name, COALESCE(description,''), trigger, status, current_version,
		       created_at, updated_at, version
		FROM workflow_definition
		WHERE status = 'published'
		  AND deleted_at IS NULL
		  AND trigger->>'type' = 'event'
		  AND trigger->>'event' = $1`, event)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*domain.WorkflowDefinition
	for rows.Next() {
		var d domain.WorkflowDefinition
		if err := scanDef(rows, &d); err != nil {
			return nil, err
		}
		out = append(out, &d)
	}
	return out, rows.Err()
}

// PublishVersion sets definition status='published' and current_version=rev.
func (s *Definitions) PublishVersion(ctx context.Context, tid, defID uuid.UUID, rev, version int) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		// Verify the version row exists
		var versionID uuid.UUID
		err := tx.QueryRow(ctx,
			"SELECT id FROM workflow_version WHERE definition_id=$1 AND rev=$2 AND tenant_id=$3",
			defID, rev, tid).Scan(&versionID)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("version rev=%d not found", rev)
		}
		if err != nil {
			return err
		}

		// Mark version as published
		_, err = tx.Exec(ctx,
			"UPDATE workflow_version SET published_at=now() WHERE id=$1", versionID)
		if err != nil {
			return err
		}

		// Update definition
		ct, err := tx.Exec(ctx, `
			UPDATE workflow_definition SET
			  status='published', current_version=$3, updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$4 AND deleted_at IS NULL`,
			defID, tid, rev, version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return nil
	})
}

const defSelect = `
    SELECT id, tenant_id, name, COALESCE(description,''), trigger, status, current_version,
           created_at, updated_at, version
    FROM workflow_definition`

type rowScanner interface{ Scan(dest ...any) error }

func scanDef(r rowScanner, d *domain.WorkflowDefinition) error {
	return r.Scan(
		&d.ID, &d.TenantID, &d.Name, &d.Description, &d.Trigger, &d.Status, &d.CurrentVersion,
		&d.CreatedAt, &d.UpdatedAt, &d.Version)
}
