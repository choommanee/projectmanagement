package service

import (
	"github.com/pmplatform/services/sales-svc/internal/store"
)

// Service aggregates all sales domain stores.
type Service struct {
	Customers   *store.CustomerStore
	SalesOrders *store.SalesOrderStore
}

func New(customers *store.CustomerStore, salesOrders *store.SalesOrderStore) *Service {
	return &Service{
		Customers:   customers,
		SalesOrders: salesOrders,
	}
}
