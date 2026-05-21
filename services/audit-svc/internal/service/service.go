package service

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/pmplatform/services/audit-svc/internal/domain"
	"github.com/pmplatform/services/audit-svc/internal/store"
)

// Service is the thin application service layer for audit queries.
type Service struct {
	store *store.Store
}

// New creates a new Service.
func New(s *store.Store) *Service {
	return &Service{store: s}
}

// List returns paginated audit events for a tenant.
func (s *Service) List(ctx context.Context, tid uuid.UUID, opts store.ListOpts) ([]domain.Event, int, error) {
	return s.store.List(ctx, tid, opts)
}

// GetByID returns a single audit event by ID.
func (s *Service) GetByID(ctx context.Context, tid uuid.UUID, id string) (domain.Event, error) {
	return s.store.GetByID(ctx, tid, id)
}

// Buckets returns daily activity counts per service for the past N days.
func (s *Service) Buckets(ctx context.Context, tid uuid.UUID, days int) ([]domain.Bucket, error) {
	return s.store.Buckets(ctx, tid, days)
}

// ParseTime parses an ISO 8601 datetime string or returns nil.
func ParseTime(s string) *time.Time {
	if s == "" {
		return nil
	}
	formats := []string{time.RFC3339, "2006-01-02T15:04:05", "2006-01-02"}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return &t
		}
	}
	return nil
}
