package store

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/workflow-svc/internal/domain"
)

// WorkflowTemplate represents a system-provided workflow template.
// Templates are not tenant-scoped — they are global seed data.
type WorkflowTemplate struct {
	ID          uuid.UUID       `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Category    string          `json:"category"`
	Definition  json.RawMessage `json:"definition"`
	IsSystem    bool            `json:"isSystem"`
	CreatedAt   time.Time       `json:"createdAt"`
}

type Templates struct{ pool *pgxpool.Pool }

func NewTemplates(pool *pgxpool.Pool) *Templates { return &Templates{pool: pool} }

func (s *Templates) List(ctx context.Context) ([]WorkflowTemplate, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, name, description, category, definition, is_system, created_at
         FROM workflow_template ORDER BY category, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WorkflowTemplate
	for rows.Next() {
		var t WorkflowTemplate
		if err := rows.Scan(&t.ID, &t.Name, &t.Description, &t.Category, &t.Definition, &t.IsSystem, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Templates) GetByID(ctx context.Context, id uuid.UUID) (*WorkflowTemplate, error) {
	var t WorkflowTemplate
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, description, category, definition, is_system, created_at
         FROM workflow_template WHERE id = $1`, id,
	).Scan(&t.ID, &t.Name, &t.Description, &t.Category, &t.Definition, &t.IsSystem, &t.CreatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, domain.ErrNotFound
		}
		return nil, err
	}
	return &t, nil
}
