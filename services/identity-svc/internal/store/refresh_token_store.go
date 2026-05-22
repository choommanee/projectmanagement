package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/identity-svc/internal/domain"
)

// RefreshTokens persists refresh_token rows. RLS requires app.current_tenant
// to be set inside the same transaction as any DML; we use a per-call tx
// wrapper for that (mirroring user_store).
type RefreshTokens struct{ p *pgxpool.Pool }

func NewRefreshTokens(p *pgxpool.Pool) *RefreshTokens { return &RefreshTokens{p: p} }

func (s *RefreshTokens) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

// Insert persists a fresh row. The caller is responsible for filling
// TokenHash (sha256, 32 bytes) and FamilyID (uuid.New() for a fresh family,
// inherited on rotation). ID is assigned by the DB when zero.
func (s *RefreshTokens) Insert(ctx context.Context, rt *domain.RefreshToken) error {
	if rt.ID == uuid.Nil {
		rt.ID = uuid.New()
	}
	if rt.IssuedAt.IsZero() {
		rt.IssuedAt = time.Now().UTC()
	}
	return s.withTenant(ctx, rt.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
            INSERT INTO refresh_token(id, tenant_id, user_id, token_hash, parent_id, family_id, issued_at, expires_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			rt.ID, rt.TenantID, rt.UserID, rt.TokenHash, rt.ParentID, rt.FamilyID, rt.IssuedAt, rt.ExpiresAt)
		return err
	})
}

// FindByHash looks up a row by its token_hash. RLS would normally hide
// rows from other tenants, but Refresh has no tenant context yet — the row
// IS what tells us the tenant. We therefore intentionally bypass the tenant
// RLS guard here by NOT setting app.current_tenant; the unique constraint
// on token_hash makes the lookup safe.
//
// Returns domain.ErrRefreshTokenInvalid on miss so callers don't need to
// translate pgx.ErrNoRows themselves.
func (s *RefreshTokens) FindByHash(ctx context.Context, hash []byte) (*domain.RefreshToken, error) {
	var rt domain.RefreshToken
	var parent *uuid.UUID
	var revoked *time.Time
	err := s.p.QueryRow(ctx, `
        SELECT id, tenant_id, user_id, token_hash, parent_id, family_id, issued_at, expires_at, revoked_at
          FROM refresh_token
         WHERE token_hash = $1`, hash).Scan(
		&rt.ID, &rt.TenantID, &rt.UserID, &rt.TokenHash, &parent, &rt.FamilyID,
		&rt.IssuedAt, &rt.ExpiresAt, &revoked)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrRefreshTokenInvalid
	}
	if err != nil {
		return nil, err
	}
	rt.ParentID = parent
	rt.RevokedAt = revoked
	return &rt, nil
}

// MarkRevoked marks a single row as revoked at now(). Idempotent: revoking
// an already-revoked row is a no-op (the existing revoked_at is preserved).
func (s *RefreshTokens) MarkRevoked(ctx context.Context, tid, id uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
            UPDATE refresh_token
               SET revoked_at = COALESCE(revoked_at, now())
             WHERE id = $1`, id)
		return err
	})
}

// RevokeAllForUser marks every live refresh_token row for (tenant, user)
// as revoked. Used by password-reset to invalidate every session the user
// might have open after they've changed credentials.
func (s *RefreshTokens) RevokeAllForUser(ctx context.Context, tid, uid uuid.UUID) (int64, error) {
	var n int64
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
            UPDATE refresh_token
               SET revoked_at = COALESCE(revoked_at, now())
             WHERE tenant_id = $1
               AND user_id   = $2
               AND revoked_at IS NULL`, tid, uid)
		if err != nil {
			return err
		}
		n = ct.RowsAffected()
		return nil
	})
	return n, err
}

// RevokeFamily marks every row sharing family_id as revoked. Called on
// reuse-detection: once any descendant is presented after being rotated,
// the whole lineage is compromised.
func (s *RefreshTokens) RevokeFamily(ctx context.Context, tid, familyID uuid.UUID) (int64, error) {
	var n int64
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
            UPDATE refresh_token
               SET revoked_at = COALESCE(revoked_at, now())
             WHERE family_id = $1
               AND revoked_at IS NULL`, familyID)
		if err != nil {
			return err
		}
		n = ct.RowsAffected()
		return nil
	})
	return n, err
}
