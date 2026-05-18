package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/document-svc/internal/domain"
)

type Templates struct{ p *pgxpool.Pool }

func NewTemplates(p *pgxpool.Pool) *Templates { return &Templates{p: p} }

func (s *Templates) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

// Create inserts a new template.
func (s *Templates) Create(ctx context.Context, t *domain.Template) error {
	bodyJSON := toJSON(t.Body)
	return s.withTenant(ctx, t.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO document_template(id, tenant_id, type, name, body, is_system)
			VALUES ($1,$2,$3,$4,$5,$6)`,
			t.ID, t.TenantID, string(t.Type), t.Name, bodyJSON, t.IsSystem,
		)
		return err
	})
}

// ListByType returns all templates for a given type.
func (s *Templates) ListByType(ctx context.Context, tid uuid.UUID, docType domain.DocumentType) ([]*domain.Template, error) {
	var items []*domain.Template
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, type, name, body, is_system, created_at
			FROM document_template
			WHERE tenant_id=$1 AND type=$2
			ORDER BY name`,
			tid, string(docType),
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var t domain.Template
			var bodyBytes []byte
			if err := rows.Scan(&t.ID, &t.TenantID, &t.Type, &t.Name, &bodyBytes, &t.IsSystem, &t.CreatedAt); err != nil {
				return err
			}
			t.Body = fromJSON(bodyBytes)
			items = append(items, &t)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return items, nil
}

// ListAll returns all templates for a tenant (when no type filter is applied).
func (s *Templates) ListAll(ctx context.Context, tid uuid.UUID) ([]*domain.Template, error) {
	var items []*domain.Template
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, type, name, body, is_system, created_at
			FROM document_template
			WHERE tenant_id=$1
			ORDER BY type, name`,
			tid,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var t domain.Template
			var bodyBytes []byte
			if err := rows.Scan(&t.ID, &t.TenantID, &t.Type, &t.Name, &bodyBytes, &t.IsSystem, &t.CreatedAt); err != nil {
				return err
			}
			t.Body = fromJSON(bodyBytes)
			items = append(items, &t)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return items, nil
}

// GetByID fetches a single template.
func (s *Templates) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Template, error) {
	var t domain.Template
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		var bodyBytes []byte
		return tx.QueryRow(ctx, `
			SELECT id, tenant_id, type, name, body, is_system, created_at
			FROM document_template
			WHERE id=$1 AND tenant_id=$2`,
			id, tid,
		).Scan(&t.ID, &t.TenantID, &t.Type, &t.Name, &bodyBytes, &t.IsSystem, &t.CreatedAt)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}
