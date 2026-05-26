package service

import (
	"github.com/pmplatform/services/accounting-svc/internal/store"
)

// Service aggregates all accounting domain stores.
type Service struct {
	Accounts       *store.AccountStore
	JournalEntries *store.JournalEntryStore
	Invoices       *store.InvoiceStore
}

func New(accounts *store.AccountStore, journalEntries *store.JournalEntryStore, invoices *store.InvoiceStore) *Service {
	return &Service{
		Accounts:       accounts,
		JournalEntries: journalEntries,
		Invoices:       invoices,
	}
}
