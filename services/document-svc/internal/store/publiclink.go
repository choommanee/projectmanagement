package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/document-svc/internal/domain"
)

// VerifyLinks is the public-verification link store (document_verify_link,
// migration 00010).
//
// RLS posture: tenant-scoped methods (Create / Revoke / ListForEnvelope /
// IncrementAccess) run inside the standard SET LOCAL app.current_tenant
// transaction. ResolveByTokenHash is the one deliberate exception — the
// anonymous public caller has no tenant context, so it selects by token_hash
// WITHOUT the GUC (permitted by the doc_verify_link_public_lookup SELECT
// policy) and returns the row's tenant_id; every subsequent read the service
// performs (envelope, events, certificate) then runs through the normal
// tenant-scoped path so RLS on all other tables stays fully enforced.
type VerifyLinks struct {
	p *pgxpool.Pool
}

func NewVerifyLinks(p *pgxpool.Pool) *VerifyLinks { return &VerifyLinks{p: p} }

func (s *VerifyLinks) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

const linkCols = `id, tenant_id, envelope_id, created_by, created_at, expires_at, revoked_at, access_count, last_accessed_at`

func scanLink(row pgx.Row) (*domain.VerifyLink, error) {
	var l domain.VerifyLink
	err := row.Scan(&l.ID, &l.TenantID, &l.EnvelopeID, &l.CreatedBy, &l.CreatedAt,
		&l.ExpiresAt, &l.RevokedAt, &l.AccessCount, &l.LastAccessedAt)
	return &l, err
}

// NewVerifyToken mints a 256-bit url-safe random token and its SHA-256 hex
// digest. Only the digest may be persisted.
func NewVerifyToken() (raw, hash string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", "", err
	}
	raw = base64.RawURLEncoding.EncodeToString(b)
	return raw, HashVerifyToken(raw), nil
}

// HashVerifyToken returns the SHA-256 hex digest used as the storage key.
func HashVerifyToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// Create persists a link row (hash only) inside the tenant scope.
func (s *VerifyLinks) Create(ctx context.Context, tid, envID uuid.UUID, tokenHash string, createdBy *uuid.UUID, expiresAt *time.Time) (*domain.VerifyLink, error) {
	var link *domain.VerifyLink
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		var e error
		link, e = scanLink(tx.QueryRow(ctx,
			`INSERT INTO document_verify_link (tenant_id, envelope_id, token_hash, created_by, expires_at)
			 VALUES ($1,$2,$3,$4,$5) RETURNING `+linkCols,
			tid, envID, tokenHash, createdBy, expiresAt))
		return e
	})
	if err != nil {
		return nil, err
	}
	return link, nil
}

// ResolveByTokenHash looks a link up by token hash with NO tenant context —
// the deliberate public-resolution exception documented in migration 00010.
// Returns domain.ErrNotFound for unknown hashes; revoked/expired filtering is
// the service's job so all misses stay indistinguishable to the caller.
func (s *VerifyLinks) ResolveByTokenHash(ctx context.Context, tokenHash string) (*domain.VerifyLink, error) {
	link, err := scanLink(s.p.QueryRow(ctx,
		`SELECT `+linkCols+` FROM document_verify_link WHERE token_hash=$1`, tokenHash))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return link, nil
}

// Revoke stamps revoked_at on a link (idempotent; 404 if the link is not in
// the tenant/envelope scope).
func (s *VerifyLinks) Revoke(ctx context.Context, tid, envID, linkID uuid.UUID) (*domain.VerifyLink, error) {
	var link *domain.VerifyLink
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		var e error
		link, e = scanLink(tx.QueryRow(ctx,
			`UPDATE document_verify_link SET revoked_at=COALESCE(revoked_at, now())
			 WHERE id=$1 AND envelope_id=$2 RETURNING `+linkCols, linkID, envID))
		return e
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return link, nil
}

// ListForEnvelope returns all links (hashes excluded) for an envelope.
func (s *VerifyLinks) ListForEnvelope(ctx context.Context, tid, envID uuid.UUID) ([]domain.VerifyLink, error) {
	out := []domain.VerifyLink{}
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT `+linkCols+` FROM document_verify_link WHERE envelope_id=$1 ORDER BY created_at DESC`, envID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var l domain.VerifyLink
			if err := rows.Scan(&l.ID, &l.TenantID, &l.EnvelopeID, &l.CreatedBy, &l.CreatedAt,
				&l.ExpiresAt, &l.RevokedAt, &l.AccessCount, &l.LastAccessedAt); err != nil {
				return err
			}
			out = append(out, l)
		}
		return rows.Err()
	})
	return out, err
}

// IncrementAccess bumps access_count + last_accessed_at after a successful
// public report. Runs tenant-scoped (the tenant was resolved from the link).
func (s *VerifyLinks) IncrementAccess(ctx context.Context, tid, linkID uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`UPDATE document_verify_link SET access_count=access_count+1, last_accessed_at=now() WHERE id=$1`, linkID)
		return err
	})
}
