package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Pool = pgxpool.Pool

func New(ctx context.Context, dsn string) (*Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	return pgxpool.NewWithConfig(ctx, cfg)
}
