package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/hr-svc/internal/domain"
)

type PositionStore struct{ p *pgxpool.Pool }

func NewPositionStore(p *pgxpool.Pool) *PositionStore { return &PositionStore{p: p} }

const posSelect = `
    SELECT id, tenant_id, code, name, grade, active, created_at, updated_at, version
    FROM position`

func scanPos(row interface{ Scan(...any) error }, p *domain.Position) error {
	return row.Scan(
		&p.ID, &p.TenantID, &p.Code, &p.Name, &p.Grade,
		&p.Active, &p.CreatedAt, &p.UpdatedAt, &p.Version,
	)
}

func (s *PositionStore) Create(ctx context.Context, pos *domain.Position) error {
	pos.ID = uuid.New()
	pos.CreatedAt = time.Now()
	pos.UpdatedAt = pos.CreatedAt
	pos.Version = 1
	return withTenant(ctx, s.p, pos.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO position(id, tenant_id, code, name, grade, active, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			pos.ID, pos.TenantID, pos.Code, pos.Name, pos.Grade, pos.Active, pos.Version,
		)
		return err
	})
}

func (s *PositionStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Position, error) {
	var pos domain.Position
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanPos(tx.QueryRow(ctx, posSelect+" WHERE id=$1", id), &pos)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &pos, nil
}

type ListPositionOpts struct {
	Query  string
	Limit  int
	Offset int
}

func (s *PositionStore) List(ctx context.Context, tid uuid.UUID, opts ListPositionOpts) ([]*domain.Position, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if opts.Query != "" {
		where = append(where, fmt.Sprintf("(code ILIKE $%d OR name ILIKE $%d)", idx, idx))
		args = append(args, "%"+opts.Query+"%")
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.Position
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			posSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY code ASC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var p domain.Position
			if err := scanPos(rows, &p); err != nil {
				return err
			}
			items = append(items, &p)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM position WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdatePositionInput struct {
	Name    string
	Grade   string
	Active  bool
	Version int
}

func (s *PositionStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdatePositionInput) (*domain.Position, error) {
	var pos domain.Position
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE position
			SET name=$3, grade=$4, active=$5, updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$6`,
			id, tid, in.Name, in.Grade, in.Active, in.Version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return scanPos(tx.QueryRow(ctx, posSelect+" WHERE id=$1", id), &pos)
	})
	if errors.Is(err, domain.ErrConflict) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return &pos, nil
}

func (s *PositionStore) Delete(ctx context.Context, tid, id uuid.UUID, version int) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			`DELETE FROM position WHERE id=$1 AND tenant_id=$2 AND version=$3`,
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
