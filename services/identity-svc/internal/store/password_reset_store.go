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

// PasswordResets persists password_reset_token rows. RLS requires
// app.current_tenant to be set in-tx for DML; FindByHash deliberately
// bypasses tenant scoping because the row IS what tells us the tenant
// (same pattern as RefreshTokens.FindByHash).
type PasswordResets struct{ p *pgxpool.Pool }

func NewPasswordResets(p *pgxpool.Pool) *PasswordResets { return &PasswordResets{p: p} }

func (s *PasswordResets) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

// Insert persists a fresh row. ID is assigned when zero.
func (s *PasswordResets) Insert(ctx context.Context, rt *domain.PasswordResetToken) error {
	if rt.ID == uuid.Nil {
		rt.ID = uuid.New()
	}
	if rt.CreatedAt.IsZero() {
		rt.CreatedAt = time.Now().UTC()
	}
	return s.withTenant(ctx, rt.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
            INSERT INTO password_reset_token(id, tenant_id, user_id, token_hash, expires_at, created_at)
            VALUES ($1,$2,$3,$4,$5,$6)`,
			rt.ID, rt.TenantID, rt.UserID, rt.TokenHash, rt.ExpiresAt, rt.CreatedAt)
		return err
	})
}

// FindByHash looks up a row by token_hash. Bypasses tenant RLS for the
// same reason RefreshTokens.FindByHash does — the unique constraint on
// token_hash plus its 32-byte sha256 width makes the lookup safe.
func (s *PasswordResets) FindByHash(ctx context.Context, hash []byte) (*domain.PasswordResetToken, error) {
	var rt domain.PasswordResetToken
	var consumed *time.Time
	err := s.p.QueryRow(ctx, `
        SELECT id, tenant_id, user_id, token_hash, expires_at, consumed_at, created_at
          FROM password_reset_token
         WHERE token_hash = $1`, hash).Scan(
		&rt.ID, &rt.TenantID, &rt.UserID, &rt.TokenHash, &rt.ExpiresAt, &consumed, &rt.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrPasswordResetInvalid
	}
	if err != nil {
		return nil, err
	}
	rt.ConsumedAt = consumed
	return &rt, nil
}

// MarkConsumed stamps consumed_at = now() on the row. Idempotent: an
// already-consumed row keeps its first consumed_at.
func (s *PasswordResets) MarkConsumed(ctx context.Context, tid, id uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
            UPDATE password_reset_token
               SET consumed_at = COALESCE(consumed_at, now())
             WHERE id = $1`, id)
		return err
	})
}
