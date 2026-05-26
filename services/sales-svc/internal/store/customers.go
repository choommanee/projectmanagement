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

	"github.com/pmplatform/services/sales-svc/internal/domain"
)

type CustomerStore struct{ p *pgxpool.Pool }

func NewCustomerStore(p *pgxpool.Pool) *CustomerStore { return &CustomerStore{p: p} }

const customerSelect = `
    SELECT id, tenant_id, code, name, contact, email, phone, billing_address,
           active, created_at, updated_at, version
    FROM customer`

func scanCustomer(row interface{ Scan(...any) error }, c *domain.Customer) error {
	return row.Scan(
		&c.ID, &c.TenantID, &c.Code, &c.Name, &c.Contact, &c.Email,
		&c.Phone, &c.BillingAddress, &c.Active, &c.CreatedAt, &c.UpdatedAt, &c.Version,
	)
}

func (s *CustomerStore) Create(ctx context.Context, c *domain.Customer) error {
	c.ID = uuid.New()
	c.CreatedAt = time.Now()
	c.UpdatedAt = c.CreatedAt
	c.Version = 1
	return withTenant(ctx, s.p, c.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO customer(id, tenant_id, code, name, contact, email, phone,
			                     billing_address, active, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			c.ID, c.TenantID, c.Code, c.Name, c.Contact, c.Email, c.Phone,
			c.BillingAddress, c.Active, c.Version,
		)
		return err
	})
}

func (s *CustomerStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Customer, error) {
	var c domain.Customer
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanCustomer(tx.QueryRow(ctx, customerSelect+" WHERE id=$1", id), &c)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

type ListCustomerOpts struct {
	Query  string
	Limit  int
	Offset int
}

func (s *CustomerStore) List(ctx context.Context, tid uuid.UUID, opts ListCustomerOpts) ([]*domain.Customer, int, error) {
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
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.Customer
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			customerSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY code ASC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c domain.Customer
			if err := scanCustomer(rows, &c); err != nil {
				return err
			}
			items = append(items, &c)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM customer WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdateCustomerInput struct {
	Name           string
	Contact        string
	Email          string
	Phone          string
	BillingAddress string
	Active         bool
	Version        int
}

func (s *CustomerStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdateCustomerInput) (*domain.Customer, error) {
	var c domain.Customer
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE customer
			SET name=$3, contact=$4, email=$5, phone=$6, billing_address=$7,
			    active=$8, updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$9`,
			id, tid, in.Name, in.Contact, in.Email, in.Phone, in.BillingAddress,
			in.Active, in.Version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return scanCustomer(tx.QueryRow(ctx, customerSelect+" WHERE id=$1", id), &c)
	})
	if errors.Is(err, domain.ErrConflict) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *CustomerStore) Delete(ctx context.Context, tid, id uuid.UUID, version int) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			`DELETE FROM customer WHERE id=$1 AND tenant_id=$2 AND version=$3`,
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
