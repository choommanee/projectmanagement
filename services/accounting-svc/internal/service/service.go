package service

import (
	"context"

	"github.com/pmplatform/libs/go/audit"
	"github.com/pmplatform/services/accounting-svc/internal/store"
)

// AuditPublisher is satisfied by *audit.PgPublisher and *audit.Fallback.
type AuditPublisher interface {
	Publish(ctx context.Context, action string, ev audit.Event) error
}

// Service aggregates all accounting domain stores.
type Service struct {
	Accounts       *store.AccountStore
	JournalEntries *store.JournalEntryStore
	Invoices       *store.InvoiceStore
	Budgets        *store.BudgetStore

	// Audit records significant mutations to audit_log. Optional: nil makes
	// the audit helper a no-op.
	Audit AuditPublisher
}

func New(accounts *store.AccountStore, journalEntries *store.JournalEntryStore, invoices *store.InvoiceStore, budgets *store.BudgetStore) *Service {
	return &Service{
		Accounts:       accounts,
		JournalEntries: journalEntries,
		Invoices:       invoices,
		Budgets:        budgets,
	}
}

// WithAudit attaches an audit publisher and returns the service for chaining.
func (s *Service) WithAudit(p AuditPublisher) *Service {
	s.Audit = p
	return s
}
