package service

import (
	"github.com/pmplatform/services/sales-svc/internal/store"
)

// Service aggregates all sales domain stores.
type Service struct {
	Customers     *store.CustomerStore
	SalesOrders   *store.SalesOrderStore
	Quotations    *store.QuotationStore
	Invoices      *store.SalesInvoiceStore
	Shipments     *store.ShipmentStore
	Opportunities *store.OpportunityStore
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
