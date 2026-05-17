package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Sessions struct{ p *pgxpool.Pool }

func NewSessions(p *pgxpool.Pool) *Sessions { return &Sessions{p: p} }

func HashToken(t string) string {
	sum := sha256.Sum256([]byte(t))
	return hex.EncodeToString(sum[:])
}

type Session struct {
	ID, UserID, TenantID uuid.UUID
	RefreshHash          string
	ExpiresAt            time.Time
}

func (s *Sessions) Create(ctx context.Context, sess Session) error {
	_, err := s.p.Exec(ctx, `
        INSERT INTO session(id, user_id, tenant_id, refresh_token_hash, expires_at)
        VALUES ($1,$2,$3,$4,$5)`,
		sess.ID, sess.UserID, sess.TenantID, sess.RefreshHash, sess.ExpiresAt)
	return err
}
