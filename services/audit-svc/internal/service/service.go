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

// ParseTime parses an ISO 8601 datetime string or returns nil. A date-only
// value ("2006-01-02") is treated as the START of that day (00:00:00), which is
// the correct inclusive lower bound for a `from` filter.
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

// ParseTimeUpper parses a value for use as an inclusive UPPER bound (a `to`
// filter). A date-only value ("2006-01-02") is expanded to the END of that day
// (23:59:59.999999999) so that `ts <= to` includes every event on that day —
// otherwise a same-day range (from==to, e.g. the audit sparkline drill-down)
// would match only events at exactly midnight and return nothing.
func ParseTimeUpper(s string) *time.Time {
	if s == "" {
		return nil
	}
	// Date-only → end of that calendar day.
	if t, err := time.Parse("2006-01-02", s); err == nil {
		eod := t.Add(24*time.Hour - time.Nanosecond)
		return &eod
	}
	// Otherwise fall back to the standard datetime parse.
	return ParseTime(s)
}
