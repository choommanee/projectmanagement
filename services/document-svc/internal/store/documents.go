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

	"github.com/pmplatform/services/document-svc/internal/domain"
)

type Documents struct{ p *pgxpool.Pool }

func NewDocuments(p *pgxpool.Pool) *Documents { return &Documents{p: p} }

func (s *Documents) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

func toJSON(m map[string]any) []byte {
	if m == nil {
		return []byte("{}")
	}
	b, _ := json.Marshal(m)
	return b
}

func fromJSON(b []byte) map[string]any {
	if len(b) == 0 {
		return map[string]any{}
	}
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	return m
}

// Create inserts a document and its initial version (rev=1) atomically.
func (s *Documents) Create(ctx context.Context, d *domain.Document) error {
	bodyJSON := toJSON(d.Body)
	return s.withTenant(ctx, d.TenantID, func(tx pgx.Tx) error {
		// Insert document (without current_version_id first)
		_, err := tx.Exec(ctx, `
			INSERT INTO document(id, tenant_id, workspace_id, project_id, type, title, body, status, owner_id, tags, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			d.ID, d.TenantID, d.WorkspaceID, d.ProjectID, string(d.Type), d.Title,
			bodyJSON, string(d.Status), d.OwnerID, d.Tags, d.Version,
		)
		if err != nil {
			return err
		}

		// Insert initial version rev=1
		verID := uuid.New()
		_, err = tx.Exec(ctx, `
			INSERT INTO document_version(id, document_id, tenant_id, rev, title, body, status, created_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			verID, d.ID, d.TenantID, 1, d.Title, bodyJSON, string(d.Status), d.OwnerID,
		)
		if err != nil {
			return err
		}

		// Update document.current_version_id
		_, err = tx.Exec(ctx, `UPDATE document SET current_version_id=$1 WHERE id=$2`, verID, d.ID)
		if err != nil {
			return err
		}
		d.CurrentVersionID = &verID
		return nil
	})
}

// GetByID returns a document by ID (not soft-deleted).
func (s *Documents) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Document, error) {
	var d domain.Document
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		var bodyBytes, metaBytes []byte
		err := tx.QueryRow(ctx, `
			SELECT id, tenant_id, workspace_id, project_id, type, title, body, metadata, status,
			       owner_id, tags, current_version_id, created_at, updated_at, version
			FROM document
			WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
			id, tid,
		).Scan(&d.ID, &d.TenantID, &d.WorkspaceID, &d.ProjectID, &d.Type, &d.Title, &bodyBytes,
			&metaBytes, &d.Status, &d.OwnerID, &d.Tags, &d.CurrentVersionID, &d.CreatedAt, &d.UpdatedAt, &d.Version)
		if err != nil {
			return err
		}
		d.Body = fromJSON(bodyBytes)
		d.Metadata = fromJSON(metaBytes)
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

type ListDocsOpts struct {
	WorkspaceID *uuid.UUID
	ProjectID   *uuid.UUID
	Type        string
	Status      string
	Q           string
	Limit       int
	Offset      int
}

// List returns paginated documents with optional filters.
func (s *Documents) List(ctx context.Context, tid uuid.UUID, opts ListDocsOpts) ([]*domain.Document, int, error) {
	if opts.Limit <= 0 || opts.Limit > 200 {
		opts.Limit = 50
	}
	where := []string{"tenant_id = $1", "deleted_at IS NULL"}
	args := []any{tid}
	idx := 2

	if opts.WorkspaceID != nil {
		where = append(where, fmt.Sprintf("workspace_id = $%d", idx))
		args = append(args, *opts.WorkspaceID)
		idx++
	}
	if opts.ProjectID != nil {
		where = append(where, fmt.Sprintf("project_id = $%d", idx))
		args = append(args, *opts.ProjectID)
		idx++
	}
	if opts.Type != "" {
		where = append(where, fmt.Sprintf("type = $%d", idx))
		args = append(args, opts.Type)
		idx++
	}
	if opts.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, opts.Status)
		idx++
	}
	if opts.Q != "" {
		where = append(where, fmt.Sprintf("title ILIKE $%d", idx))
		args = append(args, "%"+opts.Q+"%")
		idx++
	}

	whereSQL := strings.Join(where, " AND ")

	var items []*domain.Document
	var total int
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			fmt.Sprintf(`
				SELECT id, tenant_id, workspace_id, project_id, type, title, body, metadata, status,
				       owner_id, tags, current_version_id, created_at, updated_at, version
				FROM document
				WHERE %s
				ORDER BY created_at DESC
				LIMIT $%d OFFSET $%d`, whereSQL, idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var d domain.Document
			var bodyBytes, metaBytes []byte
			if err := rows.Scan(&d.ID, &d.TenantID, &d.WorkspaceID, &d.ProjectID, &d.Type, &d.Title, &bodyBytes,
				&metaBytes, &d.Status, &d.OwnerID, &d.Tags, &d.CurrentVersionID, &d.CreatedAt, &d.UpdatedAt, &d.Version); err != nil {
				return err
			}
			d.Body = fromJSON(bodyBytes)
			d.Metadata = fromJSON(metaBytes)
			items = append(items, &d)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx,
			fmt.Sprintf("SELECT count(*) FROM document WHERE %s", whereSQL), args...,
		).Scan(&total)
	})
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// Update applies a patch to the document and writes a new version snapshot atomically.
func (s *Documents) Update(ctx context.Context, d *domain.Document) error {
	bodyJSON := toJSON(d.Body)
	metaJSON := toJSON(d.Metadata)
	return s.withTenant(ctx, d.TenantID, func(tx pgx.Tx) error {
		// Optimistic lock update
		ct, err := tx.Exec(ctx, `
			UPDATE document SET
			  title=$3, body=$4, metadata=$5, status=$6, owner_id=$7, tags=$8,
			  updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$9 AND deleted_at IS NULL`,
			d.ID, d.TenantID, d.Title, bodyJSON, metaJSON, string(d.Status), d.OwnerID, d.Tags, d.Version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}

		// Determine next rev
		var maxRev int
		if err := tx.QueryRow(ctx,
			"SELECT COALESCE(MAX(rev),0) FROM document_version WHERE document_id=$1", d.ID,
		).Scan(&maxRev); err != nil {
			return err
		}
		newRev := maxRev + 1

		// Insert new version snapshot
		verID := uuid.New()
		_, err = tx.Exec(ctx, `
			INSERT INTO document_version(id, document_id, tenant_id, rev, title, body, status, created_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			verID, d.ID, d.TenantID, newRev, d.Title, bodyJSON, string(d.Status), d.OwnerID,
		)
		if err != nil {
			return err
		}

		// Update current_version_id
		_, err = tx.Exec(ctx, `UPDATE document SET current_version_id=$1 WHERE id=$2`, verID, d.ID)
		if err != nil {
			return err
		}

		d.Version++
		d.CurrentVersionID = &verID
		return nil
	})
}

// SoftDelete marks a document as deleted.
func (s *Documents) SoftDelete(ctx context.Context, tid, id uuid.UUID, version int) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE document SET deleted_at=now(), updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$3 AND deleted_at IS NULL`,
			id, tid, version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return nil
	})
}

// ListVersions returns all versions for a document, newest first.
func (s *Documents) ListVersions(ctx context.Context, tid, docID uuid.UUID) ([]*domain.DocumentVersion, error) {
	var items []*domain.DocumentVersion
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, document_id, tenant_id, rev, title, body, status, created_by, created_at, COALESCE(note,'')
			FROM document_version
			WHERE document_id=$1 AND tenant_id=$2
			ORDER BY rev DESC`,
			docID, tid,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var v domain.DocumentVersion
			var bodyBytes []byte
			if err := rows.Scan(&v.ID, &v.DocumentID, &v.TenantID, &v.Rev, &v.Title, &bodyBytes,
				&v.Status, &v.CreatedBy, &v.CreatedAt, &v.Note); err != nil {
				return err
			}
			v.Body = fromJSON(bodyBytes)
			items = append(items, &v)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return items, nil
}

// GetVersion returns a specific version by rev number.
func (s *Documents) GetVersion(ctx context.Context, tid, docID uuid.UUID, rev int) (*domain.DocumentVersion, error) {
	var v domain.DocumentVersion
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		var bodyBytes []byte
		err := tx.QueryRow(ctx, `
			SELECT id, document_id, tenant_id, rev, title, body, status, created_by, created_at, COALESCE(note,'')
			FROM document_version
			WHERE document_id=$1 AND tenant_id=$2 AND rev=$3`,
			docID, tid, rev,
		).Scan(&v.ID, &v.DocumentID, &v.TenantID, &v.Rev, &v.Title, &bodyBytes,
			&v.Status, &v.CreatedBy, &v.CreatedAt, &v.Note)
		if err != nil {
			return err
		}
		v.Body = fromJSON(bodyBytes)
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// Restore loads a historical version body, writes a new version on top, and updates the document.
func (s *Documents) Restore(ctx context.Context, tid, docID uuid.UUID, rev, currentVersion int) (*domain.Document, error) {
	var restored *domain.Document
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		// Load the target version
		var ver domain.DocumentVersion
		var bodyBytes []byte
		err := tx.QueryRow(ctx, `
			SELECT id, document_id, tenant_id, rev, title, body, status, created_by, created_at, COALESCE(note,'')
			FROM document_version
			WHERE document_id=$1 AND tenant_id=$2 AND rev=$3`,
			docID, tid, rev,
		).Scan(&ver.ID, &ver.DocumentID, &ver.TenantID, &ver.Rev, &ver.Title, &bodyBytes,
			&ver.Status, &ver.CreatedBy, &ver.CreatedAt, &ver.Note)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return domain.ErrNotFound
			}
			return err
		}
		ver.Body = fromJSON(bodyBytes)

		// Optimistic lock update of document
		ct, err := tx.Exec(ctx, `
			UPDATE document SET
			  title=$3, body=$4, status=$5,
			  updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$6 AND deleted_at IS NULL`,
			docID, tid, ver.Title, bodyBytes, string(ver.Status), currentVersion,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}

		// Determine next rev
		var maxRev int
		if err := tx.QueryRow(ctx,
			"SELECT COALESCE(MAX(rev),0) FROM document_version WHERE document_id=$1", docID,
		).Scan(&maxRev); err != nil {
			return err
		}
		newRev := maxRev + 1

		// Insert new version snapshot
		newVerID := uuid.New()
		_, err = tx.Exec(ctx, `
			INSERT INTO document_version(id, document_id, tenant_id, rev, title, body, status, created_by, note)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			newVerID, docID, tid, newRev, ver.Title, bodyBytes, string(ver.Status), ver.CreatedBy,
			fmt.Sprintf("Restored from rev %d", rev),
		)
		if err != nil {
			return err
		}

		// Update current_version_id
		_, err = tx.Exec(ctx, `UPDATE document SET current_version_id=$1 WHERE id=$2`, newVerID, docID)
		if err != nil {
			return err
		}

		// Fetch the updated document
		var d domain.Document
		var dBodyBytes, dMetaBytes []byte
		err = tx.QueryRow(ctx, `
			SELECT id, tenant_id, workspace_id, project_id, type, title, body, metadata, status,
			       owner_id, tags, current_version_id, created_at, updated_at, version
			FROM document
			WHERE id=$1 AND tenant_id=$2`,
			docID, tid,
		).Scan(&d.ID, &d.TenantID, &d.WorkspaceID, &d.ProjectID, &d.Type, &d.Title, &dBodyBytes,
			&dMetaBytes, &d.Status, &d.OwnerID, &d.Tags, &d.CurrentVersionID, &d.CreatedAt, &d.UpdatedAt, &d.Version)
		if err != nil {
			return err
		}
		d.Body = fromJSON(dBodyBytes)
		d.Metadata = fromJSON(dMetaBytes)
		restored = &d
		return nil
	})
	if err != nil {
		return nil, err
	}
	return restored, nil
}
