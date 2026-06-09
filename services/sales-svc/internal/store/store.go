package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// nextCode generates a sequential, human-readable document code scoped to the
// tenant, e.g. SO-000001. It must be called inside an open tenant transaction so
// the count is consistent with the row about to be inserted. The unique
// (tenant_id, <code>) constraint on the target table is the final guard against
// rare concurrent collisions.
func nextCode(ctx context.Context, tx pgx.Tx, tid uuid.UUID, table, prefix string) (string, error) {
	var n int
	q := fmt.Sprintf("SELECT count(*) FROM %s WHERE tenant_id=$1", table)
	if err := tx.QueryRow(ctx, q, tid).Scan(&n); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s-%06d", prefix, n+1), nil
}

// withTenant is a shared helper to wrap ops in a tenant-scoped transaction.
func withTenant(ctx context.Context, p *pgxpool.Pool, tid uuid.UUID, fn func(pgx.Tx) error) error {
	tx, err := p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String())); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
