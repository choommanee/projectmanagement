package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/accounting-svc/internal/domain"
)

type AccountStore struct{ p *pgxpool.Pool }

func NewAccountStore(p *pgxpool.Pool) *AccountStore { return &AccountStore{p: p} }

const coaSelect = `
    SELECT id, tenant_id, code, name, account_type, currency,
           active, created_at, updated_at, version
    FROM chart_of_account`

func scanAccount(row interface{ Scan(...any) error }, a *domain.ChartOfAccount) error {
	return row.Scan(
		&a.ID, &a.TenantID, &a.Code, &a.Name, &a.AccountType, &a.Currency,
		&a.Active, &a.CreatedAt, &a.UpdatedAt, &a.Version,
	)
}

func (s *AccountStore) Create(ctx context.Context, a *domain.ChartOfAccount) error {
	a.ID = uuid.New()
	a.CreatedAt = time.Now()
	a.UpdatedAt = a.CreatedAt
	a.Version = 1
	return withTenant(ctx, s.p, a.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO chart_of_account(id, tenant_id, code, name, account_type, currency, active, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			a.ID, a.TenantID, a.Code, a.Name, a.AccountType, a.Currency, a.Active, a.Version,
		)
		return err
	})
}

func (s *AccountStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.ChartOfAccount, error) {
	var a domain.ChartOfAccount
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanAccount(tx.QueryRow(ctx, coaSelect+" WHERE id=$1", id), &a)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

type ListAccountOpts struct {
	Query       string
	AccountType string
	Limit       int
	Offset      int
}

func (s *AccountStore) List(ctx context.Context, tid uuid.UUID, opts ListAccountOpts) ([]*domain.ChartOfAccount, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if opts.Query != "" {
		where = append(where, fmt.Sprintf("(code ILIKE $%d OR name ILIKE $%d)", idx, idx))
		args = append(args, "%"+opts.Query+"%")
		idx++
	}
	if opts.AccountType != "" {
		where = append(where, fmt.Sprintf("account_type = $%d", idx))
		args = append(args, opts.AccountType)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.ChartOfAccount
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			coaSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY code ASC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a domain.ChartOfAccount
			if err := scanAccount(rows, &a); err != nil {
				return err
			}
			items = append(items, &a)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM chart_of_account WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdateAccountInput struct {
	Name        string
	AccountType string
	Currency    string
	Active      bool
	Version     int
}

func (s *AccountStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdateAccountInput) (*domain.ChartOfAccount, error) {
	var a domain.ChartOfAccount
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE chart_of_account
			SET name=$3, account_type=$4, currency=$5, active=$6,
			    updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$7`,
			id, tid, in.Name, in.AccountType, in.Currency, in.Active, in.Version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return scanAccount(tx.QueryRow(ctx, coaSelect+" WHERE id=$1", id), &a)
	})
	if errors.Is(err, domain.ErrConflict) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (s *AccountStore) Delete(ctx context.Context, tid, id uuid.UUID, version int) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			`DELETE FROM chart_of_account WHERE id=$1 AND tenant_id=$2 AND version=$3`,
			id, tid, version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return nil
	})
}
