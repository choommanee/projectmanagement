package store

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/workflow-svc/internal/domain"
)

type Versions struct{ p *pgxpool.Pool }

func NewVersions(p *pgxpool.Pool) *Versions { return &Versions{p: p} }

func (s *Versions) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
	return (&Definitions{p: s.p}).withTenant(ctx, tid, fn)
}

func (s *Versions) Create(ctx context.Context, v *domain.WorkflowVersion) error {
	return s.withTenant(ctx, v.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO workflow_version(id, tenant_id, definition_id, rev, dsl, created_by, notes)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			v.ID, v.TenantID, v.DefinitionID, v.Rev, v.DSL, v.CreatedBy, v.Notes)
		return err
	})
}

func (s *Versions) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.WorkflowVersion, error) {
	var v domain.WorkflowVersion
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return scanVersion(tx.QueryRow(ctx,
			versionSelect+" WHERE wv.id=$1 AND wv.tenant_id=$2", id, tid), &v)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func (s *Versions) GetCurrent(ctx context.Context, tid, defID uuid.UUID) (*domain.WorkflowVersion, error) {
	var v domain.WorkflowVersion
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return scanVersion(tx.QueryRow(ctx, `
			SELECT wv.id, wv.tenant_id, wv.definition_id, wv.rev, wv.dsl,
			       wv.published_at, wv.created_by, COALESCE(wv.notes,''), wv.created_at
			FROM workflow_version wv
			JOIN workflow_definition wd ON wd.id = wv.definition_id
			WHERE wv.definition_id=$1 AND wv.tenant_id=$2 AND wv.rev = wd.current_version`,
			defID, tid), &v)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func (s *Versions) ListByDefinition(ctx context.Context, tid, defID uuid.UUID) ([]*domain.WorkflowVersion, error) {
	var items []*domain.WorkflowVersion
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			versionSelect+" WHERE wv.definition_id=$1 AND wv.tenant_id=$2 ORDER BY wv.rev DESC",
			defID, tid)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var v domain.WorkflowVersion
			if err := scanVersion(rows, &v); err != nil {
				return err
			}
			items = append(items, &v)
		}
		return rows.Err()
	})
	return items, err
}

const versionSelect = `
    SELECT wv.id, wv.tenant_id, wv.definition_id, wv.rev, wv.dsl,
           wv.published_at, wv.created_by, COALESCE(wv.notes,''), wv.created_at
    FROM workflow_version wv`

func scanVersion(r rowScanner, v *domain.WorkflowVersion) error {
	return r.Scan(
		&v.ID, &v.TenantID, &v.DefinitionID, &v.Rev, &v.DSL,
		&v.PublishedAt, &v.CreatedBy, &v.Notes, &v.CreatedAt)
}
