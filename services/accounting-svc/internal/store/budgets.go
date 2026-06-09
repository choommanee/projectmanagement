package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/accounting-svc/internal/domain"
)

type BudgetStore struct{ p *pgxpool.Pool }

func NewBudgetStore(p *pgxpool.Pool) *BudgetStore { return &BudgetStore{p: p} }

// Upsert sets the budget target for one account, replacing any existing value.
func (s *BudgetStore) Upsert(ctx context.Context, tid, accountID uuid.UUID, amount float64) (*domain.AccountBudget, error) {
	var b domain.AccountBudget
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO account_budget(tenant_id, account_id, amount)
			VALUES ($1,$2,$3)
			ON CONFLICT (tenant_id, account_id)
			DO UPDATE SET amount=EXCLUDED.amount, updated_at=now()
			RETURNING id, tenant_id, account_id, amount, created_at, updated_at`,
			tid, accountID, amount,
		).Scan(&b.ID, &b.TenantID, &b.AccountID, &b.Amount, &b.CreatedAt, &b.UpdatedAt)
	})
	if err != nil {
		return nil, err
	}
	return &b, nil
}

// List returns every budget target for the tenant.
func (s *BudgetStore) List(ctx context.Context, tid uuid.UUID) ([]*domain.AccountBudget, error) {
	var items []*domain.AccountBudget
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, account_id, amount, created_at, updated_at
			FROM account_budget WHERE tenant_id=$1 ORDER BY account_id`, tid)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var b domain.AccountBudget
			if err := rows.Scan(&b.ID, &b.TenantID, &b.AccountID, &b.Amount, &b.CreatedAt, &b.UpdatedAt); err != nil {
				return err
			}
			items = append(items, &b)
		}
		return rows.Err()
	})
	return items, err
}
