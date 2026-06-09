package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/pmplatform/services/notification-svc/internal/domain"
	"github.com/pmplatform/services/notification-svc/internal/store"
)

// Service is the application layer over store.
type Service struct {
	store *store.Store
	prefs *store.PreferenceStore
}

// New creates a new Service.
func New(s *store.Store) *Service { return &Service{store: s} }

// WithPreferences attaches the preference store so the HTTP API can read and
// write per-user channel preferences. Returns the receiver for chaining.
func (s *Service) WithPreferences(p *store.PreferenceStore) *Service {
	s.prefs = p
	return s
}

// Store exposes the underlying store (used by the NATS worker for inserts).
func (s *Service) Store() *store.Store { return s.store }

// List returns notifications for one (tenant, user).
func (s *Service) List(ctx context.Context, tid, uid uuid.UUID, opts store.ListOpts) ([]domain.Notification, error) {
	return s.store.List(ctx, tid, uid, opts)
}

// Count returns the total notification count for one (tenant, user).
func (s *Service) Count(ctx context.Context, tid, uid uuid.UUID, opts store.ListOpts) (int, error) {
	return s.store.Count(ctx, tid, uid, opts)
}

// MarkRead marks one notification read.
func (s *Service) MarkRead(ctx context.Context, tid, uid uuid.UUID, id string) error {
	return s.store.MarkRead(ctx, tid, uid, id)
}

// MarkAllRead marks every unread row for the user as read.
func (s *Service) MarkAllRead(ctx context.Context, tid, uid uuid.UUID) (int64, error) {
	return s.store.MarkAllRead(ctx, tid, uid)
}

// ListPreferences returns the user's per-kind channel preferences.
func (s *Service) ListPreferences(ctx context.Context, tid, uid uuid.UUID) ([]domain.Preference, error) {
	return s.prefs.List(ctx, tid, uid)
}

// SetPreferences upserts the supplied per-kind channel preferences.
func (s *Service) SetPreferences(ctx context.Context, tid, uid uuid.UUID, prefs []domain.Preference) error {
	return s.prefs.UpsertMany(ctx, tid, uid, prefs)
}
