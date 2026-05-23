package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PreferenceStore wraps pgxpool for notification_preference queries.
type PreferenceStore struct {
	p *pgxpool.Pool
}

// NewPreference creates a new PreferenceStore.
func NewPreference(p *pgxpool.Pool) *PreferenceStore {
	return &PreferenceStore{p: p}
}

// Get returns the channels for a given (tenant, user, kind).
// Falls back to []string{"inapp"} if no row exists.
func (s *PreferenceStore) Get(ctx context.Context, tenantID, userID uuid.UUID, kind string) ([]string, error) {
	var channels []string
	err := withTenant(ctx, s.p, tenantID, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx,
			`SELECT channels FROM notification_preference WHERE user_id = $1::uuid AND kind = $2`,
			userID.String(), kind,
		)
		return row.Scan(&channels)
	})
	if err != nil {
		if isNoRows(err) {
			return []string{"inapp"}, nil
		}
		return nil, err
	}
	return channels, nil
}

// Upsert inserts or updates a preference row.
func (s *PreferenceStore) Upsert(ctx context.Context, tenantID, userID uuid.UUID, kind string, channels []string) error {
	return withTenant(ctx, s.p, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO notification_preference(tenant_id, user_id, kind, channels)
			VALUES ($1::uuid, $2::uuid, $3, $4)
			ON CONFLICT (tenant_id, user_id, kind)
			DO UPDATE SET channels = EXCLUDED.channels, updated_at = now()`,
			tenantID.String(), userID.String(), kind, channels,
		)
		return err
	})
}

// isNoRows reports whether err is a "no rows" sentinel from pgx.
func isNoRows(err error) bool {
	return err == pgx.ErrNoRows
}
