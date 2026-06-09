package service

import (
	"context"

	"github.com/pmplatform/libs/go/audit"
	"github.com/pmplatform/services/sales-svc/internal/store"
)

// AuditPublisher is satisfied by *audit.PgPublisher and *audit.Fallback.
// Kept as an interface so the service layer never depends on a concrete
// transport (NATS vs. direct Postgres).
type AuditPublisher interface {
	Publish(ctx context.Context, action string, ev audit.Event) error
}

// Service aggregates all sales domain stores.
type Service struct {
	Customers     *store.CustomerStore
	SalesOrders   *store.SalesOrderStore
	Quotations    *store.QuotationStore
	Invoices      *store.SalesInvoiceStore
	Shipments     *store.ShipmentStore
	Opportunities *store.OpportunityStore

	// Audit records significant mutations to the audit_log table. Optional:
	// when nil the audit helper is a no-op so the service still boots in
	// environments without a configured publisher.
	Audit AuditPublisher
}

// WithAudit attaches an audit publisher and returns the service for chaining.
func (s *Service) WithAudit(p AuditPublisher) *Service {
	s.Audit = p
	return s
}

func New(
	customers *store.CustomerStore,
	salesOrders *store.SalesOrderStore,
	quotations *store.QuotationStore,
	invoices *store.SalesInvoiceStore,
	shipments *store.ShipmentStore,
	opportunities *store.OpportunityStore,
) *Service {
	return &Service{
		Customers:     customers,
		SalesOrders:   salesOrders,
		Quotations:    quotations,
		Invoices:      invoices,
		Shipments:     shipments,
		Opportunities: opportunities,
	}
}
