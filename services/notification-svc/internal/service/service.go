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
}

// New creates a new Service.
func New(s *store.Store) *Service { return &Service{store: s} }

// Store exposes the underlying store (used by the NATS worker for inserts).
func (s *Service) Store() *store.Store { return s.store }

// List returns notifications for one (tenant, user).
func (s *Service) List(ctx context.Context, tid, uid uuid.UUID, opts store.ListOpts) ([]domain.Notification, error) {
	return s.store.List(ctx, tid, uid, opts)
}

// MarkRead marks one notification read.
func (s *Service) MarkRead(ctx context.Context, tid, uid uuid.UUID, id string) error {
	return s.store.MarkRead(ctx, tid, uid, id)
}

// MarkAllRead marks every unread row for the user as read.
func (s *Service) MarkAllRead(ctx context.Context, tid, uid uuid.UUID) (int64, error) {
	return s.store.MarkAllRead(ctx, tid, uid)
}
