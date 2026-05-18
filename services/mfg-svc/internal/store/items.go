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

	"github.com/pmplatform/services/mfg-svc/internal/domain"
)

// Items handles item and uom storage.
type Items struct{ p *pgxpool.Pool }

func NewItems(p *pgxpool.Pool) *Items { return &Items{p: p} }

func (s *Items) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

// --- UOM ---

func (s *Items) CreateUOM(ctx context.Context, u *domain.UOM) error {
	return s.withTenant(ctx, u.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO uom(id, tenant_id, code, name, ratio_to_base)
			VALUES ($1,$2,$3,$4,$5)`,
			u.ID, u.TenantID, u.Code, u.Name, u.RatioToBase)
		return err
	})
}

func (s *Items) GetUOMByID(ctx context.Context, tid, id uuid.UUID) (*domain.UOM, error) {
	var u domain.UOM
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT id, tenant_id, code, name, ratio_to_base FROM uom WHERE id = $1`, id).
			Scan(&u.ID, &u.TenantID, &u.Code, &u.Name, &u.RatioToBase)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Items) ListUOMs(ctx context.Context, tid uuid.UUID) ([]*domain.UOM, error) {
	var list []*domain.UOM
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT id, tenant_id, code, name, ratio_to_base FROM uom WHERE tenant_id = $1 ORDER BY code`, tid)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var u domain.UOM
			if err := rows.Scan(&u.ID, &u.TenantID, &u.Code, &u.Name, &u.RatioToBase); err != nil {
				return err
			}
			list = append(list, &u)
		}
		return rows.Err()
	})
	return list, err
}

// --- Items ---

const itemSelect = `
    SELECT id, tenant_id, code, name, COALESCE(description,''), type, status, uom_id,
           lot_tracked, serial_tracked, attrs, created_at, updated_at, version
    FROM item`

func scanItem(row interface{ Scan(...any) error }, it *domain.Item) error {
	var attrs []byte
	err := row.Scan(&it.ID, &it.TenantID, &it.Code, &it.Name, &it.Description,
		&it.Type, &it.Status, &it.UomID, &it.LotTracked, &it.SerialTracked,
		&attrs, &it.CreatedAt, &it.UpdatedAt, &it.Version)
	if err != nil {
		return err
	}
	if len(attrs) > 0 {
		_ = json.Unmarshal(attrs, &it.Attrs)
	}
	if it.Attrs == nil {
		it.Attrs = map[string]any{}
	}
	return nil
}

func (s *Items) Create(ctx context.Context, it *domain.Item) error {
	attrs, _ := json.Marshal(it.Attrs)
	return s.withTenant(ctx, it.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO item(id, tenant_id, code, name, description, type, status, uom_id,
			                 lot_tracked, serial_tracked, attrs, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			it.ID, it.TenantID, it.Code, it.Name, it.Description, it.Type, it.Status, it.UomID,
			it.LotTracked, it.SerialTracked, attrs, it.Version)
		return err
	})
}

func (s *Items) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Item, error) {
	var it domain.Item
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return scanItem(tx.QueryRow(ctx, itemSelect+" WHERE id = $1 AND deleted_at IS NULL", id), &it)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &it, nil
}

func (s *Items) GetByCode(ctx context.Context, tid uuid.UUID, code string) (*domain.Item, error) {
	var it domain.Item
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return scanItem(tx.QueryRow(ctx, itemSelect+" WHERE code = $1 AND deleted_at IS NULL", code), &it)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &it, nil
}

type ListItemsOpts struct {
	Q      string
	Type   string
	Status string
	Limit  int
	Offset int
}

func (s *Items) List(ctx context.Context, tid uuid.UUID, opts ListItemsOpts) ([]*domain.Item, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1", "deleted_at IS NULL"}
	args := []any{tid}
	idx := 2

	if opts.Q != "" {
		where = append(where, fmt.Sprintf("(code ILIKE $%d OR name ILIKE $%d)", idx, idx))
		args = append(args, "%"+opts.Q+"%")
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
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.Item
	var total int
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			itemSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY code LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var it domain.Item
			if err := scanItem(rows, &it); err != nil {
				return err
			}
			items = append(items, &it)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM item WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

func (s *Items) Update(ctx context.Context, it *domain.Item) error {
	attrs, _ := json.Marshal(it.Attrs)
	return s.withTenant(ctx, it.TenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE item SET name=$3, description=$4, type=$5, status=$6, uom_id=$7,
			                lot_tracked=$8, serial_tracked=$9, attrs=$10,
			                updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$11 AND deleted_at IS NULL`,
			it.ID, it.TenantID, it.Name, it.Description, it.Type, it.Status, it.UomID,
			it.LotTracked, it.SerialTracked, attrs, it.Version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		it.Version++
		return nil
	})
}

func (s *Items) SoftDelete(ctx context.Context, tid, id uuid.UUID, version int) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE item SET deleted_at=now(), updated_at=now(), version=version+1
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
