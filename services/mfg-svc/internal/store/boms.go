package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
)

// BOMs handles BOM header and line storage.
type BOMs struct{ p *pgxpool.Pool }

func NewBOMs(p *pgxpool.Pool) *BOMs { return &BOMs{p: p} }

func (s *BOMs) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

// --- BOM Header ---

const bomHeaderSelect = `
    SELECT id, tenant_id, item_id, version, is_default, status,
           effective_from, effective_to, COALESCE(notes,''), created_at, updated_at
    FROM bom_header`

func scanBOMHeader(row interface{ Scan(...any) error }, h *domain.BOMHeader) error {
	return row.Scan(&h.ID, &h.TenantID, &h.ItemID, &h.Version, &h.IsDefault, &h.Status,
		&h.EffectiveFrom, &h.EffectiveTo, &h.Notes, &h.CreatedAt, &h.UpdatedAt)
}

func (s *BOMs) CreateHeader(ctx context.Context, h *domain.BOMHeader) error {
	return s.withTenant(ctx, h.TenantID, func(tx pgx.Tx) error {
		// Determine next version for this item
		var maxVer int
		_ = tx.QueryRow(ctx, `SELECT COALESCE(MAX(version),0) FROM bom_header WHERE item_id = $1`, h.ItemID).Scan(&maxVer)
		h.Version = maxVer + 1
		h.ID = uuid.New()
		_, err := tx.Exec(ctx, `
			INSERT INTO bom_header(id, tenant_id, item_id, version, is_default, status, notes)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			h.ID, h.TenantID, h.ItemID, h.Version, h.IsDefault, h.Status, h.Notes)
		return err
	})
}

func (s *BOMs) GetHeaderByID(ctx context.Context, tid, id uuid.UUID) (*domain.BOMHeader, error) {
	var h domain.BOMHeader
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return scanBOMHeader(tx.QueryRow(ctx, bomHeaderSelect+" WHERE id = $1", id), &h)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &h, nil
}

func (s *BOMs) ListByItem(ctx context.Context, tid, itemID uuid.UUID) ([]*domain.BOMHeader, error) {
	var list []*domain.BOMHeader
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, bomHeaderSelect+" WHERE tenant_id = $1 AND item_id = $2 ORDER BY version", tid, itemID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var h domain.BOMHeader
			if err := scanBOMHeader(rows, &h); err != nil {
				return err
			}
			list = append(list, &h)
		}
		return rows.Err()
	})
	return list, err
}

func (s *BOMs) UpdateHeader(ctx context.Context, h *domain.BOMHeader) error {
	return s.withTenant(ctx, h.TenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE bom_header SET is_default=$3, status=$4, notes=$5,
			                      effective_from=$6, effective_to=$7, updated_at=now()
			WHERE id=$1 AND tenant_id=$2`,
			h.ID, h.TenantID, h.IsDefault, h.Status, h.Notes, h.EffectiveFrom, h.EffectiveTo)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}

func (s *BOMs) MarkActive(ctx context.Context, tid, id uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		// Get the item_id for this header
		var itemID uuid.UUID
		if err := tx.QueryRow(ctx, `SELECT item_id FROM bom_header WHERE id = $1`, id).Scan(&itemID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return domain.ErrNotFound
			}
			return err
		}
		// Clear is_default on other headers for this item
		if _, err := tx.Exec(ctx, `UPDATE bom_header SET is_default=false WHERE item_id=$1 AND id<>$2`, itemID, id); err != nil {
			return err
		}
		// Set this header active + default
		ct, err := tx.Exec(ctx, `UPDATE bom_header SET status='active', is_default=true, updated_at=now() WHERE id=$1`, id)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}

func (s *BOMs) MarkObsolete(ctx context.Context, tid, id uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `UPDATE bom_header SET status='obsolete', updated_at=now() WHERE id=$1 AND tenant_id=$2`, id, tid)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}

// --- BOM Lines ---

const bomLineSelect = `
    SELECT id, tenant_id, header_id, child_item_id, qty, uom_id,
           alternate_of_id, is_phantom, scrap_pct, sort_order, COALESCE(notes,'')
    FROM bom_line`

func scanBOMLine(row interface{ Scan(...any) error }, l *domain.BOMLine) error {
	return row.Scan(&l.ID, &l.TenantID, &l.HeaderID, &l.ChildItemID, &l.Qty, &l.UomID,
		&l.AlternateOfID, &l.IsPhantom, &l.ScrapPct, &l.SortOrder, &l.Notes)
}

func (s *BOMs) AddLine(ctx context.Context, l *domain.BOMLine) error {
	l.ID = uuid.New()
	return s.withTenant(ctx, l.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO bom_line(id, tenant_id, header_id, child_item_id, qty, uom_id,
			                     alternate_of_id, is_phantom, scrap_pct, sort_order, notes)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			l.ID, l.TenantID, l.HeaderID, l.ChildItemID, l.Qty, l.UomID,
			l.AlternateOfID, l.IsPhantom, l.ScrapPct, l.SortOrder, l.Notes)
		return err
	})
}

func (s *BOMs) UpdateLine(ctx context.Context, l *domain.BOMLine) error {
	return s.withTenant(ctx, l.TenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE bom_line SET child_item_id=$3, qty=$4, uom_id=$5, is_phantom=$6,
			                    scrap_pct=$7, sort_order=$8, notes=$9
			WHERE id=$1 AND tenant_id=$2`,
			l.ID, l.TenantID, l.ChildItemID, l.Qty, l.UomID, l.IsPhantom, l.ScrapPct, l.SortOrder, l.Notes)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}

func (s *BOMs) DeleteLine(ctx context.Context, tid, id uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `DELETE FROM bom_line WHERE id=$1 AND tenant_id=$2`, id, tid)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}

func (s *BOMs) ListByHeader(ctx context.Context, tid, headerID uuid.UUID) ([]*domain.BOMLine, error) {
	var list []*domain.BOMLine
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, bomLineSelect+" WHERE header_id = $1 ORDER BY sort_order, id", headerID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var l domain.BOMLine
			if err := scanBOMLine(rows, &l); err != nil {
				return err
			}
			list = append(list, &l)
		}
		return rows.Err()
	})
	return list, err
}

// ExplodeMultiLevel performs a recursive BOM explosion using a CTE.
func (s *BOMs) ExplodeMultiLevel(ctx context.Context, tid, itemID uuid.UUID, qty float64) ([]domain.ExplodeRow, error) {
	var rows []domain.ExplodeRow
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		r, err := tx.Query(ctx, `
WITH RECURSIVE explode AS (
  SELECT bh.id AS header_id, bl.child_item_id AS item_id, bl.qty * $1 AS req_qty, 1 AS lvl
  FROM bom_header bh
  JOIN bom_line bl ON bl.header_id = bh.id
  WHERE bh.item_id = $2 AND bh.status = 'active' AND bh.is_default = true
  UNION ALL
  SELECT bh2.id, bl2.child_item_id, bl2.qty * e.req_qty, e.lvl + 1
  FROM explode e
  JOIN bom_header bh2 ON bh2.item_id = e.item_id AND bh2.status = 'active' AND bh2.is_default = true
  JOIN bom_line bl2 ON bl2.header_id = bh2.id
  WHERE e.lvl < 10
)
SELECT e.lvl, e.item_id, i.code, i.name, e.req_qty, u.code, i.type
FROM explode e
JOIN item i ON i.id = e.item_id
JOIN uom u ON u.id = i.uom_id
ORDER BY e.lvl, i.code`, qty, itemID)
		if err != nil {
			return err
		}
		defer r.Close()
		for r.Next() {
			var row domain.ExplodeRow
			if err := r.Scan(&row.Level, &row.ItemID, &row.ItemCode, &row.ItemName, &row.Qty, &row.UomCode, &row.ItemType); err != nil {
				return err
			}
			rows = append(rows, row)
		}
		return r.Err()
	})
	return rows, err
}
