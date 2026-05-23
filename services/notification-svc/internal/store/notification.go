package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/notification-svc/internal/domain"
)

// Store wraps a pgxpool for notification queries.
type Store struct {
	p *pgxpool.Pool
}

// New creates a new notification Store.
func New(p *pgxpool.Pool) *Store {
	return &Store{p: p}
}

// Pool exposes the underlying pool (used by tests).
func (s *Store) Pool() *pgxpool.Pool { return s.p }

// withTenant opens a tx with SET LOCAL app.current_tenant for RLS.
func withTenant(ctx context.Context, p *pgxpool.Pool, tid uuid.UUID, fn func(pgx.Tx) error) error {
	tx, err := p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String())); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// InsertParams carries the fields needed to persist an inbound NATS event.
type InsertParams struct {
	ID       string // optional, generated if empty
	TenantID uuid.UUID
	UserID   uuid.UUID
	Kind     string
	Title    string
	Body     string
	Payload  map[string]any
}

// Insert persists a new notification row under the tenant's RLS context.
func (s *Store) Insert(ctx context.Context, p InsertParams) (string, error) {
	if p.Kind == "" || p.Title == "" {
		return "", errors.New("kind and title required")
	}
	if p.ID == "" {
		p.ID = uuid.NewString()
	}
	var payloadRaw []byte
	if p.Payload != nil {
		b, err := json.Marshal(p.Payload)
		if err != nil {
			return "", err
		}
		payloadRaw = b
	}
	err := withTenant(ctx, s.p, p.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO notification(id, tenant_id, user_id, kind, title, body, payload)
			VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, NULLIF($6, ''), $7::jsonb)`,
			p.ID, p.TenantID.String(), p.UserID.String(), p.Kind, p.Title, p.Body, nullableJSON(payloadRaw))
		return err
	})
	if err != nil {
		return "", err
	}
	return p.ID, nil
}

func nullableJSON(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return string(b)
}

// ListOpts filters for List.
type ListOpts struct {
	UnreadOnly bool
	Limit      int
}

const notificationSelect = `SELECT id, tenant_id, user_id, kind, title,
	coalesce(body, ''), payload, read_at, created_at
FROM notification`

// List returns notifications for one user (most recent first).
func (s *Store) List(ctx context.Context, tid, uid uuid.UUID, opts ListOpts) ([]domain.Notification, error) {
	if opts.Limit <= 0 {
		opts.Limit = 50
	}
	if opts.Limit > 500 {
		opts.Limit = 500
	}
	var out []domain.Notification
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		q := notificationSelect + ` WHERE user_id = $1::uuid`
		args := []any{uid.String()}
		if opts.UnreadOnly {
			q += ` AND read_at IS NULL`
		}
		q += ` ORDER BY created_at DESC LIMIT $2`
		args = append(args, opts.Limit)
		rows, err := tx.Query(ctx, q, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			n, err := scanNotification(rows)
			if err != nil {
				return err
			}
			out = append(out, n)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	if out == nil {
		out = []domain.Notification{}
	}
	return out, nil
}

// MarkRead marks one notification (for the given user) as read.
// Returns pgx.ErrNoRows if it doesn't exist for that user/tenant.
func (s *Store) MarkRead(ctx context.Context, tid, uid uuid.UUID, id string) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE notification
			SET read_at = COALESCE(read_at, now())
			WHERE id = $1::uuid AND user_id = $2::uuid`, id, uid.String())
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return nil
	})
}

// MarkAllRead marks every unread notification for the user as read.
// Returns the count updated.
func (s *Store) MarkAllRead(ctx context.Context, tid, uid uuid.UUID) (int64, error) {
	var n int64
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE notification
			SET read_at = now()
			WHERE user_id = $1::uuid AND read_at IS NULL`, uid.String())
		if err != nil {
			return err
		}
		n = ct.RowsAffected()
		return nil
	})
	return n, err
}

func scanNotification(row pgx.Row) (domain.Notification, error) {
	var n domain.Notification
	var payloadRaw []byte
	if err := row.Scan(
		&n.ID, &n.TenantID, &n.UserID, &n.Kind, &n.Title,
		&n.Body, &payloadRaw, &n.ReadAt, &n.CreatedAt,
	); err != nil {
		return domain.Notification{}, err
	}
	if len(payloadRaw) > 0 && string(payloadRaw) != "null" {
		_ = json.Unmarshal(payloadRaw, &n.Payload)
	}
	return n, nil
}
