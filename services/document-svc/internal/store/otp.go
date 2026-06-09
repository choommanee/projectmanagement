package store

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/pmplatform/services/document-svc/internal/domain"
)

// --- Email-OTP challenges (document_sign_otp) --------------------------------
//
// Methods live on *Signatures so they share the tenant-scoped tx helper and
// the service wiring; the table is RLS-scoped like every signer artifact.

const otpCols = `id, tenant_id, envelope_id, signer_id, code_hash, salt, expires_at, attempts, consumed_at, created_at`

func scanOTP(row pgx.Row) (*domain.SignOTPChallenge, error) {
	var c domain.SignOTPChallenge
	err := row.Scan(&c.ID, &c.TenantID, &c.EnvelopeID, &c.SignerRowID,
		&c.CodeHash, &c.Salt, &c.ExpiresAt, &c.Attempts, &c.ConsumedAt, &c.CreatedAt)
	return &c, err
}

// CreateOTPChallenge rate-limits, invalidates prior open challenges for the
// signer, and inserts a fresh challenge — all in one tenant transaction.
// Returns domain.ErrOTPRateLimited when more than OTPRateLimitMax-1 requests
// were already made inside OTPRateLimitWindow.
func (s *Signatures) CreateOTPChallenge(ctx context.Context, tid, envID, signerRowID uuid.UUID, codeHash, salt string) (*domain.SignOTPChallenge, error) {
	now := time.Now().UTC()
	var ch *domain.SignOTPChallenge
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		var recent int
		if err := tx.QueryRow(ctx,
			`SELECT COUNT(*) FROM document_sign_otp WHERE signer_id=$1 AND created_at > $2`,
			signerRowID, now.Add(-domain.OTPRateLimitWindow)).Scan(&recent); err != nil {
			return err
		}
		if recent >= domain.OTPRateLimitMax {
			return domain.ErrOTPRateLimited
		}
		// A new request supersedes any open challenge for this signer.
		if _, err := tx.Exec(ctx,
			`UPDATE document_sign_otp SET consumed_at=$2 WHERE signer_id=$1 AND consumed_at IS NULL`,
			signerRowID, now); err != nil {
			return err
		}
		var e error
		ch, e = scanOTP(tx.QueryRow(ctx,
			`INSERT INTO document_sign_otp (tenant_id, envelope_id, signer_id, code_hash, salt, expires_at)
			 VALUES ($1,$2,$3,$4,$5,$6) RETURNING `+otpCols,
			tid, envID, signerRowID, codeHash, salt, now.Add(domain.OTPExpiry)))
		return e
	})
	if err != nil {
		return nil, err
	}
	return ch, nil
}

// ConsumeOTPChallenge verifies code against the signer's open challenge and
// consumes it on success. Error taxonomy:
//
//	no open challenge        → ErrOTPRequired (request a code first)
//	challenge expired        → ErrOTPExpired
//	attempts exhausted       → ErrOTPInvalid (challenge dead)
//	wrong code               → ErrOTPInvalid (attempts incremented)
//
// The hash comparison is constant-time.
func (s *Signatures) ConsumeOTPChallenge(ctx context.Context, tid, signerRowID uuid.UUID, code string) (*domain.SignOTPChallenge, error) {
	now := time.Now().UTC()
	var ch *domain.SignOTPChallenge
	// verifyErr carries the OTP outcome OUT of the tx callback without
	// triggering a rollback — a failed attempt MUST still commit its
	// attempts increment (returning an error from fn would roll it back).
	var verifyErr error
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		var e error
		ch, e = scanOTP(tx.QueryRow(ctx,
			`SELECT `+otpCols+` FROM document_sign_otp
			 WHERE signer_id=$1 AND consumed_at IS NULL
			 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, signerRowID))
		if errors.Is(e, pgx.ErrNoRows) {
			verifyErr = domain.ErrOTPRequired
			return nil
		}
		if e != nil {
			return e
		}
		if now.After(ch.ExpiresAt) {
			verifyErr = domain.ErrOTPExpired
			return nil
		}
		if ch.Attempts >= domain.OTPMaxAttempts {
			verifyErr = domain.ErrOTPInvalid
			return nil
		}
		want := []byte(ch.CodeHash)
		got := []byte(domain.HashOTPCode(code, ch.Salt))
		if subtle.ConstantTimeCompare(want, got) != 1 {
			if _, err := tx.Exec(ctx,
				`UPDATE document_sign_otp SET attempts = attempts + 1 WHERE id=$1`, ch.ID); err != nil {
				return err
			}
			verifyErr = domain.ErrOTPInvalid
			return nil // commit the attempts increment
		}
		ch, e = scanOTP(tx.QueryRow(ctx,
			`UPDATE document_sign_otp SET consumed_at=$2 WHERE id=$1 RETURNING `+otpCols, ch.ID, now))
		return e
	})
	if err != nil {
		return nil, err
	}
	if verifyErr != nil {
		return nil, verifyErr
	}
	return ch, nil
}

// SetAuthEvidence stamps the signature row with proof of identity
// verification (jsonb {method, challenge_id, verified_at}).
func (s *Signatures) SetAuthEvidence(ctx context.Context, tid, signerRowID uuid.UUID, ev domain.AuthEvidence) error {
	raw, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			`UPDATE document_signature SET auth_evidence=$2 WHERE id=$1`, signerRowID, raw)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}

// ListAuthEvidence returns auth_evidence per signature-row id for an
// envelope (rows without evidence are omitted). Used by the certificate
// builder to render "Email OTP verified at <time>" per signer.
func (s *Signatures) ListAuthEvidence(ctx context.Context, tid, envID uuid.UUID) (map[string]domain.AuthEvidence, error) {
	out := map[string]domain.AuthEvidence{}
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT id, auth_evidence FROM document_signature
			 WHERE envelope_id=$1 AND auth_evidence IS NOT NULL`, envID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id uuid.UUID
			var raw []byte
			if err := rows.Scan(&id, &raw); err != nil {
				return err
			}
			var ev domain.AuthEvidence
			if err := json.Unmarshal(raw, &ev); err != nil {
				continue // tolerate malformed legacy rows
			}
			out[id.String()] = ev
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
