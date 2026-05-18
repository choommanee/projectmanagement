package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/document-svc/internal/domain"
)

type Comments struct{ p *pgxpool.Pool }

func NewComments(p *pgxpool.Pool) *Comments { return &Comments{p: p} }

func (s *Comments) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

// Create inserts a new comment.
func (s *Comments) Create(ctx context.Context, c *domain.Comment) error {
	anchorJSON := toJSON(c.Anchor)
	return s.withTenant(ctx, c.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO document_comment(id, tenant_id, document_id, parent_id, author_id, body, anchor)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			c.ID, c.TenantID, c.DocumentID, c.ParentID, c.AuthorID, c.Body, anchorJSON,
		)
		return err
	})
}

// ListForDocument returns all comments for a document ordered by created_at ASC.
func (s *Comments) ListForDocument(ctx context.Context, tid, docID uuid.UUID) ([]*domain.Comment, error) {
	var items []*domain.Comment
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, document_id, parent_id, author_id, body, anchor,
			       created_at, updated_at, resolved_at
			FROM document_comment
			WHERE tenant_id=$1 AND document_id=$2
			ORDER BY created_at ASC`,
			tid, docID,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c domain.Comment
			var anchorBytes []byte
			if err := rows.Scan(&c.ID, &c.TenantID, &c.DocumentID, &c.ParentID, &c.AuthorID, &c.Body,
				&anchorBytes, &c.CreatedAt, &c.UpdatedAt, &c.ResolvedAt); err != nil {
				return err
			}
			c.Anchor = fromJSON(anchorBytes)
			items = append(items, &c)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return items, nil
}

// Resolve marks a comment as resolved at now().
func (s *Comments) Resolve(ctx context.Context, tid, id uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE document_comment SET resolved_at=now(), updated_at=now()
			WHERE id=$1 AND tenant_id=$2 AND resolved_at IS NULL`,
			id, tid,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}

// Delete removes a comment permanently.
func (s *Comments) Delete(ctx context.Context, tid, id uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `DELETE FROM document_comment WHERE id=$1 AND tenant_id=$2`, id, tid)
		return err
	})
}
