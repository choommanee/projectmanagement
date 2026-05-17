package store

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/identity-svc/internal/domain"
)

type Users struct{ p *pgxpool.Pool }

func NewUsers(p *pgxpool.Pool) *Users { return &Users{p: p} }

// withTenant sets app.current_tenant inside a tx for RLS.
func (s *Users) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

func (s *Users) Create(ctx context.Context, u *domain.User) error {
	return s.withTenant(ctx, u.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
            INSERT INTO app_user(id, tenant_id, email, display_name, status, password_hash, external_idp, external_sub, version)
            VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,''),NULLIF($8,''),$9)`,
			u.ID, u.TenantID, u.Email, u.DisplayName, u.Status, u.PasswordHash, u.ExternalIDP, u.ExternalSub, u.Version)
		return err
	})
}

func (s *Users) FindByEmail(ctx context.Context, tid uuid.UUID, email string) (*domain.User, error) {
	var u domain.User
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `
            SELECT id, tenant_id, email, display_name, status, COALESCE(password_hash,''),
                   COALESCE(external_idp,''), COALESCE(external_sub,''), created_at, updated_at, version
            FROM app_user WHERE email = $1 AND deleted_at IS NULL`, email)
		return row.Scan(&u.ID, &u.TenantID, &u.Email, &u.DisplayName, &u.Status,
			&u.PasswordHash, &u.ExternalIDP, &u.ExternalSub, &u.CreatedAt, &u.UpdatedAt, &u.Version)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}
