package service

import (
	"context"

	"github.com/google/uuid"
	"github.com/pmplatform/services/reports-svc/internal/domain"
	"github.com/pmplatform/services/reports-svc/internal/store"
)

type Service struct {
	Dashboards *store.Dashboards
	Metrics    *store.Metrics
}

func New(d *store.Dashboards, m *store.Metrics) *Service {
	return &Service{Dashboards: d, Metrics: m}
}

func (s *Service) ListDashboards(ctx context.Context, tid uuid.UUID, opts store.ListDashboardsOpts) ([]*domain.DashboardFull, int, error) {
	return s.Dashboards.List(ctx, tid, opts)
}

func (s *Service) GetDashboard(ctx context.Context, tid, id uuid.UUID) (*domain.DashboardFull, error) {
	return s.Dashboards.GetByID(ctx, tid, id)
}

func (s *Service) CreateDashboard(ctx context.Context, in store.CreateDashboardInput) (*domain.DashboardFull, error) {
	return s.Dashboards.Create(ctx, in)
}

func (s *Service) UpdateDashboard(ctx context.Context, in store.UpdateDashboardInput) (*domain.DashboardFull, error) {
	return s.Dashboards.Update(ctx, in)
}

func (s *Service) DeleteDashboard(ctx context.Context, tid, id uuid.UUID, version int) error {
	return s.Dashboards.Delete(ctx, tid, id, version)
}

func (s *Service) GetSummary(ctx context.Context, tid uuid.UUID) (*domain.SummaryMetrics, error) {
	return s.Metrics.Summary(ctx, tid)
}

func (s *Service) GetTimeseries(ctx context.Context, tid uuid.UUID, metric string, days int) ([]domain.TimeseriesPoint, error) {
	return s.Metrics.Timeseries(ctx, tid, metric, days)
}

func (s *Service) GetByStatus(ctx context.Context, tid uuid.UUID, metric string) ([]domain.ByStatusPoint, error) {
	return s.Metrics.ByStatus(ctx, tid, metric)
}
