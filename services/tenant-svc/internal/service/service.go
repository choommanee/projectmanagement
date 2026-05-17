package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/pmplatform/services/tenant-svc/internal/domain"
	"github.com/pmplatform/services/tenant-svc/internal/store"
)

type Service struct{ s *store.Store }

func New(s *store.Store) *Service { return &Service{s: s} }

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
