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

type OpportunityStore struct{ p *pgxpool.Pool }

func NewOpportunityStore(p *pgxpool.Pool) *OpportunityStore { return &OpportunityStore{p: p} }

const oppSelect = `
    SELECT id, tenant_id, title, customer_id, stage, value, currency,
           expected_close_date, probability, assigned_to, notes, created_at, updated_at
    FROM opportunity`

func scanOpportunity(row interface{ Scan(...any) error }, o *domain.Opportunity) error {
	return row.Scan(
		&o.ID, &o.TenantID, &o.Title, &o.CustomerID, &o.Stage, &o.Value, &o.Currency,
		&o.ExpectedCloseDate, &o.Probability, &o.AssignedTo, &o.Notes,
		&o.CreatedAt, &o.UpdatedAt,
	)
}

func (s *OpportunityStore) Create(ctx context.Context, o *domain.Opportunity) error {
	o.ID = uuid.New()
	o.CreatedAt = time.Now()
	o.UpdatedAt = o.CreatedAt
	if o.Stage == "" {
		o.Stage = domain.StageProspect
	}
	if o.Currency == "" {
		o.Currency = "THB"
	}
	return withTenant(ctx, s.p, o.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO opportunity(id, tenant_id, title, customer_id, stage, value,
			                        currency, expected_close_date, probability, assigned_to, notes)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			o.ID, o.TenantID, o.Title, o.CustomerID, o.Stage, o.Value,
			o.Currency, o.ExpectedCloseDate, o.Probability, o.AssignedTo, o.Notes,
		)
		return err
	})
}

func (s *OpportunityStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Opportunity, error) {
	var o domain.Opportunity
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanOpportunity(tx.QueryRow(ctx, oppSelect+" WHERE id=$1", id), &o)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

type ListOpportunityOpts struct {
	Stage      string
	CustomerID *uuid.UUID
	Limit      int
	Offset     int
}

func (s *OpportunityStore) List(ctx context.Context, tid uuid.UUID, opts ListOpportunityOpts) ([]*domain.Opportunity, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if opts.Stage != "" {
		where = append(where, fmt.Sprintf("stage = $%d", idx))
		args = append(args, opts.Stage)
		idx++
	}
	if opts.CustomerID != nil {
		where = append(where, fmt.Sprintf("customer_id = $%d", idx))
		args = append(args, *opts.CustomerID)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.Opportunity
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			oppSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var o domain.Opportunity
			if err := scanOpportunity(rows, &o); err != nil {
				return err
			}
			items = append(items, &o)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM opportunity WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdateOpportunityInput struct {
	Title             string
	Stage             domain.OpportunityStage
	Value             float64
	Currency          string
	ExpectedCloseDate *time.Time
	Probability       int
	AssignedTo        *uuid.UUID
	Notes             string
}

func (s *OpportunityStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdateOpportunityInput) (*domain.Opportunity, error) {
	var o domain.Opportunity
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE opportunity
			SET title=$3, stage=$4, value=$5, currency=$6,
			    expected_close_date=$7, probability=$8, assigned_to=$9, notes=$10,
			    updated_at=now()
			WHERE id=$1 AND tenant_id=$2`,
			id, tid, in.Title, in.Stage, in.Value, in.Currency,
			in.ExpectedCloseDate, in.Probability, in.AssignedTo, in.Notes,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return scanOpportunity(tx.QueryRow(ctx, oppSelect+" WHERE id=$1", id), &o)
	})
	if errors.Is(err, domain.ErrNotFound) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// Delete hard-deletes an opportunity. Returns ErrNotFound when absent.
func (s *OpportunityStore) Delete(ctx context.Context, tid, id uuid.UUID) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			`DELETE FROM opportunity WHERE id=$1 AND tenant_id=$2`,
			id, tid,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}
