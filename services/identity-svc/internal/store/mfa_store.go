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

// MFAEnrollments persists mfa_enrollment rows. RLS requires
// app.current_tenant in-tx for any DML; the FindByUser path bypasses RLS
// because login-time step-up needs to look the row up before we've handed
// the user back through tenant scoping (the row's user_id UNIQUE constraint
// makes the lookup safe).
type MFAEnrollments struct{ p *pgxpool.Pool }

func NewMFAEnrollments(p *pgxpool.Pool) *MFAEnrollments { return &MFAEnrollments{p: p} }

func (s *MFAEnrollments) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

// Upsert inserts a fresh enrollment row OR overwrites the prior one for the
// same user. Used by Enroll: a user who started enrollment but never finished
// (confirmed_at IS NULL) can restart and we replace the abandoned row in
// place. A confirmed row is the caller's responsibility to check first —
// Enroll returns 409 if so before calling here.
func (s *MFAEnrollments) Upsert(ctx context.Context, e *domain.MFAEnrollment) error {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	return s.withTenant(ctx, e.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
            INSERT INTO mfa_enrollment(id, tenant_id, user_id, secret_encrypted, algorithm,
                                       confirmed_at, backup_codes_hashed)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT (user_id) DO UPDATE SET
                secret_encrypted    = EXCLUDED.secret_encrypted,
                algorithm           = EXCLUDED.algorithm,
                confirmed_at        = EXCLUDED.confirmed_at,
                backup_codes_hashed = EXCLUDED.backup_codes_hashed`,
			e.ID, e.TenantID, e.UserID, e.SecretEncrypted, e.Algorithm,
			e.ConfirmedAt, e.BackupCodesHashed)
		return err
	})
}

// FindByUser fetches the row by (tenant_id, user_id). Returns
// domain.ErrMFANotEnrolled on miss.
func (s *MFAEnrollments) FindByUser(ctx context.Context, tid, uid uuid.UUID) (*domain.MFAEnrollment, error) {
	var e domain.MFAEnrollment
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx, `
            SELECT id, tenant_id, user_id, secret_encrypted, algorithm,
                   confirmed_at, backup_codes_hashed, created_at
              FROM mfa_enrollment
             WHERE tenant_id = $1 AND user_id = $2`, tid, uid)
		return row.Scan(&e.ID, &e.TenantID, &e.UserID, &e.SecretEncrypted, &e.Algorithm,
			&e.ConfirmedAt, &e.BackupCodesHashed, &e.CreatedAt)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrMFANotEnrolled
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// FindByUserUnscoped looks the enrollment up bypassing tenant RLS. Login
// step-up needs this: the access path doesn't yet carry a tenant context
// (we look up the user from the login body's tenant_id, but the row itself
// is what tells us whether MFA is required — same pattern as
// RefreshTokens.FindByHash).
func (s *MFAEnrollments) FindByUserUnscoped(ctx context.Context, uid uuid.UUID) (*domain.MFAEnrollment, error) {
	var e domain.MFAEnrollment
	err := s.p.QueryRow(ctx, `
        SELECT id, tenant_id, user_id, secret_encrypted, algorithm,
               confirmed_at, backup_codes_hashed, created_at
          FROM mfa_enrollment
         WHERE user_id = $1`, uid).Scan(
		&e.ID, &e.TenantID, &e.UserID, &e.SecretEncrypted, &e.Algorithm,
		&e.ConfirmedAt, &e.BackupCodesHashed, &e.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrMFANotEnrolled
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// MarkConfirmed stamps confirmed_at = now() on the row. Idempotent.
func (s *MFAEnrollments) MarkConfirmed(ctx context.Context, tid, id uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
            UPDATE mfa_enrollment
               SET confirmed_at = COALESCE(confirmed_at, now())
             WHERE id = $1`, id)
		return err
	})
}

// UpdateBackupCodes replaces backup_codes_hashed wholesale. Used after a
// successful backup-code challenge to remove the consumed entry from the
// array (single-use). Caller supplies the trimmed slice.
func (s *MFAEnrollments) UpdateBackupCodes(ctx context.Context, tid, id uuid.UUID, codes []string) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
            UPDATE mfa_enrollment
               SET backup_codes_hashed = $1
             WHERE id = $2`, codes, id)
		return err
	})
}

// Delete drops the enrollment row entirely. Used by Disable; the user is
// effectively un-enrolled — next login skips the step-up.
func (s *MFAEnrollments) Delete(ctx context.Context, tid, uid uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
            DELETE FROM mfa_enrollment
             WHERE tenant_id = $1 AND user_id = $2`, tid, uid)
		return err
	})
}
