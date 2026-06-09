package store

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/tenant-svc/internal/domain"
)

// CustomFieldStore provides CRUD operations for custom_field_definition rows.
// The table has RLS enabled (tenant_isolation USING tenant_id = current_tenant_uuid()),
// so every operation runs inside a transaction with app.current_tenant set —
// otherwise current_tenant_uuid() returns NULL and both reads and writes are
// silently blocked.
type CustomFieldStore struct{ p *pgxpool.Pool }

// NewCustomFieldStore wires the store against the service pool.
func NewCustomFieldStore(p *pgxpool.Pool) *CustomFieldStore {
	return &CustomFieldStore{p: p}
}

// withTenant runs fn inside a tx with app.current_tenant set so RLS policies apply.
func (s *CustomFieldStore) withTenant(ctx context.Context, tenantID uuid.UUID, fn func(pgx.Tx) error) error {
	tx, err := s.p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = %q", tenantID.String())); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// List returns all custom field definitions for tenantID, optionally filtered
// by entityType (pass "" to return all entity types).
func (s *CustomFieldStore) List(ctx context.Context, tenantID uuid.UUID, entityType string) ([]domain.CustomFieldDef, error) {
	q := `SELECT id, tenant_id, entity_type, field_key, label, field_type,
	             options, required, sort_order, created_at
	      FROM custom_field_definition
	      WHERE tenant_id = $1`
	args := []any{tenantID}
	if entityType != "" {
		q += fmt.Sprintf(" AND entity_type = $%d", len(args)+1)
		args = append(args, entityType)
	}
	q += " ORDER BY sort_order, created_at"

	var out []domain.CustomFieldDef
	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, q, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var f domain.CustomFieldDef
			var optBytes []byte
			if err := rows.Scan(
				&f.ID, &f.TenantID, &f.EntityType, &f.FieldKey, &f.Label,
				(*string)(&f.FieldType), &optBytes, &f.Required, &f.SortOrder, &f.CreatedAt,
			); err != nil {
				return err
			}
			_ = json.Unmarshal(optBytes, &f.Options)
			if f.Options == nil {
				f.Options = []string{}
			}
			out = append(out, f)
		}
		return rows.Err()
	})
	return out, err
}

// Create inserts a new custom field definition and returns the created row.
func (s *CustomFieldStore) Create(ctx context.Context, tenantID uuid.UUID, p domain.CreateCustomFieldParams) (domain.CustomFieldDef, error) {
	opts, _ := json.Marshal(p.Options)
	var f domain.CustomFieldDef
	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		var optBytes []byte
		e := tx.QueryRow(ctx, `
			INSERT INTO custom_field_definition
			  (tenant_id, entity_type, field_key, label, field_type, options, required, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING id, tenant_id, entity_type, field_key, label, field_type,
			          options, required, sort_order, created_at`,
			tenantID, p.EntityType, p.FieldKey, p.Label,
			string(p.FieldType), opts, p.Required, p.SortOrder,
		).Scan(
			&f.ID, &f.TenantID, &f.EntityType, &f.FieldKey, &f.Label,
			(*string)(&f.FieldType), &optBytes, &f.Required, &f.SortOrder, &f.CreatedAt,
		)
		if e != nil {
			return e
		}
		_ = json.Unmarshal(optBytes, &f.Options)
		if f.Options == nil {
			f.Options = []string{}
		}
		return nil
	})
	return f, err
}

// Delete removes a custom field definition by id, scoped to tenantID.
func (s *CustomFieldStore) Delete(ctx context.Context, tenantID, id uuid.UUID) error {
	return s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`DELETE FROM custom_field_definition WHERE id = $1 AND tenant_id = $2`,
			id, tenantID,
		)
		return err
	})
}
