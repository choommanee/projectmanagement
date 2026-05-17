package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type txContextKey struct{}

// WithTenant runs fn inside a tx with app.current_tenant set so RLS policies apply.
func WithTenant(ctx context.Context, p *Pool, tenantID string, fn func(context.Context) error) error {
	tx, err := p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = %q", tenantID)); err != nil {
		return err
	}
	// Store the transaction in context so it can be used by queries
	txCtx := context.WithValue(ctx, txContextKey{}, tx)
	if err := fn(txCtx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// GetTx returns the transaction from context if present, nil otherwise
func GetTx(ctx context.Context) pgx.Tx {
	tx, ok := ctx.Value(txContextKey{}).(pgx.Tx)
	if !ok {
		return nil
	}
	return tx
}
