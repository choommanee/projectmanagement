package store

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/tenant-svc/internal/domain"
)

type Store struct{ p *pgxpool.Pool }

func New(p *pgxpool.Pool) *Store { return &Store{p: p} }

func (s *Store) Create(ctx context.Context, t *domain.Tenant) error {
	settings, _ := json.Marshal(t.Settings)
	_, err := s.p.Exec(ctx, `
        INSERT INTO tenant(id, slug, name, tier, status, region, settings, version)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		t.ID, t.Slug, t.Name, t.Tier, t.Status, t.Region, settings, t.Version)
	return err
}

func (s *Store) GetByID(ctx context.Context, id uuid.UUID) (*domain.Tenant, error) {
	return s.queryOne(ctx, "id = $1", id)
}

func (s *Store) GetBySlug(ctx context.Context, slug string) (*domain.Tenant, error) {
	return s.queryOne(ctx, "slug = $1", slug)
}

func (s *Store) Update(ctx context.Context, t *domain.Tenant) error {
	settings, _ := json.Marshal(t.Settings)
	ct, err := s.p.Exec(ctx, `
        UPDATE tenant SET name=$2, tier=$3, status=$4, region=$5, settings=$6,
                          updated_at=now(), version=version+1
        WHERE id=$1 AND version=$7 AND deleted_at IS NULL`,
		t.ID, t.Name, t.Tier, t.Status, t.Region, settings, t.Version)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return domain.ErrConflict
	}
	t.Version++
	return nil
}

func (s *Store) queryOne(ctx context.Context, where string, args ...any) (*domain.Tenant, error) {
	row := s.p.QueryRow(ctx,
		"SELECT id, slug, name, tier, status, region, settings, created_at, updated_at, version FROM tenant WHERE "+where+" AND deleted_at IS NULL",
		args...)
	var t domain.Tenant
	var settings []byte
	err := row.Scan(&t.ID, &t.Slug, &t.Name, &t.Tier, &t.Status, &t.Region, &settings, &t.CreatedAt, &t.UpdatedAt, &t.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(settings, &t.Settings)
	return &t, nil
}
