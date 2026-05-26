package store

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
)

// Suppliers handles supplier master data storage.
type Suppliers struct{ p *pgxpool.Pool }

// NewSuppliers constructs a Suppliers store.
func NewSuppliers(p *pgxpool.Pool) *Suppliers { return &Suppliers{p: p} }

func (s *Suppliers) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
	tx, err := s.p.Begin(ctx)
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

const supplierSelect = `
    SELECT id, tenant_id, code, name, contact, email, phone,
           lead_time_days, active, created_at, updated_at, version
    FROM supplier`

func scanSupplier(row interface{ Scan(...any) error }, sup *domain.Supplier) error {
	return row.Scan(
		&sup.ID, &sup.TenantID, &sup.Code, &sup.Name,
		&sup.Contact, &sup.Email, &sup.Phone,
		&sup.LeadTimeDays, &sup.Active,
		&sup.CreatedAt, &sup.UpdatedAt, &sup.Version,
	)
}

// Create inserts a new supplier record.
func (s *Suppliers) Create(ctx context.Context, sup *domain.Supplier) error {
	return s.withTenant(ctx, sup.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO supplier(id, tenant_id, code, name, contact, email, phone,
			                     lead_time_days, active, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			sup.ID, sup.TenantID, sup.Code, sup.Name,
			sup.Contact, sup.Email, sup.Phone,
			sup.LeadTimeDays, sup.Active, sup.Version,
		)
		return err
	})
}

// GetByID retrieves a single supplier by id within a tenant.
func (s *Suppliers) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Supplier, error) {
	var sup domain.Supplier
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return scanSupplier(
			tx.QueryRow(ctx, supplierSelect+" WHERE id = $1", id),
			&sup,
		)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &sup, nil
}

// ListSuppliersOpts are optional filters for List.
type ListSuppliersOpts struct {
	Q      string
	Active *bool
	Limit  int
	Offset int
}

// List returns tenant-scoped suppliers matching the filter options.
func (s *Suppliers) List(ctx context.Context, tid uuid.UUID, opts ListSuppliersOpts) ([]*domain.Supplier, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2

	if opts.Q != "" {
		where = append(where, fmt.Sprintf("(code ILIKE $%d OR name ILIKE $%d)", idx, idx))
		args = append(args, "%"+opts.Q+"%")
		idx++
	}
	if opts.Active != nil {
		where = append(where, fmt.Sprintf("active = $%d", idx))
		args = append(args, *opts.Active)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var list []*domain.Supplier
	var total int
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			supplierSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY code LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var sup domain.Supplier
			if err := scanSupplier(rows, &sup); err != nil {
				return err
			}
			list = append(list, &sup)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM supplier WHERE "+whereSQL, args...).Scan(&total)
	})
	return list, total, err
}

// Update applies patch fields and increments the version (optimistic lock).
func (s *Suppliers) Update(ctx context.Context, sup *domain.Supplier) error {
	return s.withTenant(ctx, sup.TenantID, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE supplier
			SET name=$3, contact=$4, email=$5, phone=$6,
			    lead_time_days=$7, active=$8,
			    updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$9`,
			sup.ID, sup.TenantID,
			sup.Name, sup.Contact, sup.Email, sup.Phone,
			sup.LeadTimeDays, sup.Active,
			sup.Version,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		sup.Version++
		return nil
	})
}

// Delete hard-deletes a supplier by id (only safe when no active POs reference it).
func (s *Suppliers) Delete(ctx context.Context, tid, id uuid.UUID) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			`DELETE FROM supplier WHERE id=$1 AND tenant_id=$2`, id, tid)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}
