package store

import (
	"context"
	"crypto/sha256"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/document-svc/internal/domain"
)

type Signatures struct{ p *pgxpool.Pool }

func NewSignatures(p *pgxpool.Pool) *Signatures { return &Signatures{p: p} }

func (s *Signatures) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

const sigCols = `id, tenant_id, document_id, signer_id, signer_email, status,
    requested_at, signed_at, declined_at, decline_reason, signature_hash, version_id`

func scanSig(row pgx.Row) (*domain.DocumentSignature, error) {
	var s domain.DocumentSignature
	err := row.Scan(
		&s.ID, &s.TenantID, &s.DocumentID, &s.SignerID, &s.SignerEmail, &s.Status,
		&s.RequestedAt, &s.SignedAt, &s.DeclinedAt, &s.DeclineReason, &s.SignatureHash, &s.VersionID,
	)
	return &s, err
}

func (s *Signatures) List(ctx context.Context, tenantID, docID uuid.UUID) ([]domain.DocumentSignature, error) {
	var out []domain.DocumentSignature
	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT `+sigCols+` FROM document_signature WHERE document_id = $1 ORDER BY requested_at ASC`, docID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var sig domain.DocumentSignature
			if err := rows.Scan(
				&sig.ID, &sig.TenantID, &sig.DocumentID, &sig.SignerID, &sig.SignerEmail, &sig.Status,
				&sig.RequestedAt, &sig.SignedAt, &sig.DeclinedAt, &sig.DeclineReason, &sig.SignatureHash, &sig.VersionID,
			); err != nil {
				return err
			}
			out = append(out, sig)
		}
		return rows.Err()
	})
	return out, err
}

func (s *Signatures) Create(ctx context.Context, tenantID, docID, signerID uuid.UUID, signerEmail string, versionID *uuid.UUID) (*domain.DocumentSignature, error) {
	var sig domain.DocumentSignature
	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`INSERT INTO document_signature (tenant_id, document_id, signer_id, signer_email, version_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING `+sigCols,
			tenantID, docID, signerID, signerEmail, versionID,
		).Scan(
			&sig.ID, &sig.TenantID, &sig.DocumentID, &sig.SignerID, &sig.SignerEmail, &sig.Status,
			&sig.RequestedAt, &sig.SignedAt, &sig.DeclinedAt, &sig.DeclineReason, &sig.SignatureHash, &sig.VersionID,
		)
	})
	if err != nil {
		return nil, err
	}
	return &sig, nil
}

func (s *Signatures) Sign(ctx context.Context, tenantID, sigID uuid.UUID) (*domain.DocumentSignature, error) {
	now := time.Now().UTC()
	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(sigID.String()+now.Format(time.RFC3339Nano))))
	var sig domain.DocumentSignature
	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`UPDATE document_signature
             SET status = 'signed', signed_at = $2, signature_hash = $3
             WHERE id = $1 AND status = 'pending'
             RETURNING `+sigCols,
			sigID, now, hash,
		).Scan(
			&sig.ID, &sig.TenantID, &sig.DocumentID, &sig.SignerID, &sig.SignerEmail, &sig.Status,
			&sig.RequestedAt, &sig.SignedAt, &sig.DeclinedAt, &sig.DeclineReason, &sig.SignatureHash, &sig.VersionID,
		)
	})
	if err != nil {
		return nil, err
	}
	return &sig, nil
}

func (s *Signatures) Decline(ctx context.Context, tenantID, sigID uuid.UUID, reason string) (*domain.DocumentSignature, error) {
	now := time.Now().UTC()
	var sig domain.DocumentSignature
	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`UPDATE document_signature
             SET status = 'declined', declined_at = $2, decline_reason = $3
             WHERE id = $1 AND status = 'pending'
             RETURNING `+sigCols,
			sigID, now, reason,
		).Scan(
			&sig.ID, &sig.TenantID, &sig.DocumentID, &sig.SignerID, &sig.SignerEmail, &sig.Status,
			&sig.RequestedAt, &sig.SignedAt, &sig.DeclinedAt, &sig.DeclineReason, &sig.SignatureHash, &sig.VersionID,
		)
	})
	if err != nil {
		return nil, err
	}
	return &sig, nil
}

func (s *Signatures) AllSigned(ctx context.Context, tenantID, docID uuid.UUID) (bool, error) {
	var pending int
	err := s.withTenant(ctx, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT COUNT(*) FROM document_signature WHERE document_id = $1 AND status = 'pending'`, docID,
		).Scan(&pending)
	})
	return pending == 0, err
}
