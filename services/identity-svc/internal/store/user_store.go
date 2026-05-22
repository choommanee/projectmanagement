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

// RolesForUser returns the role names assigned to userID inside tenantID.
// RLS is set via SET LOCAL app.current_tenant so policies on role_assignment /
// role apply. Returns an empty slice (not nil) when the user has no
// assignments, so JWT claims always serialize a JSON array.
func (s *Users) RolesForUser(ctx context.Context, tid, userID uuid.UUID) ([]string, error) {
	out := []string{}
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
            SELECT r.name
              FROM role_assignment ra
              JOIN role r ON r.id = ra.role_id
             WHERE ra.tenant_id = $1 AND ra.user_id = $2`, tid, userID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				return err
			}
			out = append(out, name)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// QuerySlug resolves a tenant UUID to its slug. The result is written into
// *out (a small contract to keep the signature symmetric with Scan-style
// helpers). Returns domain.ErrNotFound on miss.
func (s *Users) QuerySlug(ctx context.Context, tid uuid.UUID, out *string) error {
	err := s.p.QueryRow(ctx, `
        SELECT slug FROM tenant WHERE id = $1 AND deleted_at IS NULL`, tid).Scan(out)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.ErrNotFound
	}
	return err
}

// FindTenantIDBySlug resolves a tenant slug to its UUID. Used by the
// password-reset request flow where the caller knows the slug but not
// the UUID. Returns domain.ErrNotFound on miss so callers can collapse
// to the anti-enumeration 200 response without leaking which input
// (slug vs email) was unknown.
func (s *Users) FindTenantIDBySlug(ctx context.Context, slug string) (uuid.UUID, error) {
	var tid uuid.UUID
	err := s.p.QueryRow(ctx, `
        SELECT id FROM tenant
         WHERE slug = $1 AND deleted_at IS NULL`, slug).Scan(&tid)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, domain.ErrNotFound
	}
	if err != nil {
		return uuid.Nil, err
	}
	return tid, nil
}

// UpdatePassword rewrites password_hash for the user and bumps version +
// updated_at. RLS scopes by tenant via SET LOCAL.
func (s *Users) UpdatePassword(ctx context.Context, tid, uid uuid.UUID, hash string) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
            UPDATE app_user
               SET password_hash = $1,
                   updated_at    = now(),
                   version       = version + 1
             WHERE id = $2 AND deleted_at IS NULL`, hash, uid)
		return err
	})
}

// FindByID returns the user row for (tenant, id). Mirrors FindByEmail; used
// by MFA handlers that already have the user ID from JWT claims.
func (s *Users) FindByID(ctx context.Context, tid, id uuid.UUID) (*domain.User, error) {
	var u domain.User
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `
            SELECT id, tenant_id, email, display_name, status, COALESCE(password_hash,''),
                   COALESCE(external_idp,''), COALESCE(external_sub,''), created_at, updated_at, version
            FROM app_user WHERE id = $1 AND deleted_at IS NULL`, id)
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
