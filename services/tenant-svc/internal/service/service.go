package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/pmplatform/libs/go/audit"
	"github.com/pmplatform/services/tenant-svc/internal/domain"
	"github.com/pmplatform/services/tenant-svc/internal/store"
)

// AuditPublisher is satisfied by *audit.PgPublisher and *audit.Fallback.
type AuditPublisher interface {
	Publish(ctx context.Context, action string, ev audit.Event) error
}

// Service is the tenant-svc application service.
// CustomFields is optional; it is nil if the pool was not wired at boot
// (legacy tests that call New(store) without the extra store).
type Service struct {
	s            *store.Store
	CustomFields *store.CustomFieldStore

	// Audit records significant mutations to audit_log. Optional: nil makes
	// the audit helper a no-op.
	Audit AuditPublisher
}

// New creates a Service backed by the given Store. Use WithCustomFields to
// attach the custom field store.
func New(s *store.Store) *Service { return &Service{s: s} }

// WithCustomFields attaches the custom field store to the service.
func (svc *Service) WithCustomFields(cf *store.CustomFieldStore) *Service {
	svc.CustomFields = cf
	return svc
}

// WithAudit attaches an audit publisher and returns the service for chaining.
func (svc *Service) WithAudit(p AuditPublisher) *Service {
	svc.Audit = p
	return svc
}

type CreateInput struct {
	Slug, Name, Region string
	Tier               domain.Tier
}

func (svc *Service) Create(ctx context.Context, in CreateInput) (*domain.Tenant, error) {
	t, err := domain.NewTenant(in.Slug, in.Name, in.Region, in.Tier)
	if err != nil {
		return nil, err
	}
	if err := svc.s.Create(ctx, t); err != nil {
		return nil, err
	}
	return t, nil
}

func (svc *Service) Get(ctx context.Context, id uuid.UUID) (*domain.Tenant, error) {
	return svc.s.GetByID(ctx, id)
}

func (svc *Service) GetBySlug(ctx context.Context, slug string) (*domain.Tenant, error) {
	return svc.s.GetBySlug(ctx, slug)
}

type ListInput struct {
	Q            string
	Limit, Offset int
}

type ListResult struct {
	Items []*domain.Tenant
	Total int
}

func (svc *Service) List(ctx context.Context, in ListInput) (*ListResult, error) {
	items, total, err := svc.s.List(ctx, in.Q, in.Limit, in.Offset)
	if err != nil {
		return nil, err
	}
	return &ListResult{Items: items, Total: total}, nil
}

type UpdateInput struct {
	ID      uuid.UUID
	Name    string
	Tier    domain.Tier
	Status  domain.Status
	Region  string
	Version int
}

func (svc *Service) Update(ctx context.Context, in UpdateInput) (*domain.Tenant, error) {
	t, err := svc.s.GetByID(ctx, in.ID)
	if err != nil {
		return nil, err
	}
	if t.Version != in.Version {
		return nil, domain.ErrConflict
	}
	if in.Name != "" {
		t.Name = in.Name
	}
	if in.Tier != "" {
		t.Tier = in.Tier
	}
	if in.Status != "" {
		t.Status = in.Status
	}
	if in.Region != "" {
		t.Region = in.Region
	}
	if err := svc.s.Update(ctx, t); err != nil {
		return nil, err
	}
	return t, nil
}

func (svc *Service) Delete(ctx context.Context, id uuid.UUID, version int) error {
	return svc.s.SoftDelete(ctx, id, version)
}
