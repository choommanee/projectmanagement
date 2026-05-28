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

	"github.com/pmplatform/services/hr-svc/internal/domain"
)

type PerformanceReviewStore struct{ p *pgxpool.Pool }

func NewPerformanceReviewStore(p *pgxpool.Pool) *PerformanceReviewStore {
	return &PerformanceReviewStore{p: p}
}

const reviewSelect = `
    SELECT id, tenant_id, employee_id, review_period, status,
           overall_rating, self_comments, manager_comments, created_at, updated_at
    FROM performance_review`

func scanReview(row interface{ Scan(...any) error }, rv *domain.PerformanceReview) error {
	return row.Scan(
		&rv.ID, &rv.TenantID, &rv.EmployeeID, &rv.ReviewPeriod, &rv.Status,
		&rv.OverallRating, &rv.SelfComments, &rv.ManagerComments,
		&rv.CreatedAt, &rv.UpdatedAt,
	)
}

type ListReviewOpts struct {
	EmployeeID *uuid.UUID
	Status     string
	Limit      int
	Offset     int
}

func (s *PerformanceReviewStore) List(ctx context.Context, tid uuid.UUID, opts ListReviewOpts) ([]*domain.PerformanceReview, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if opts.EmployeeID != nil {
		where = append(where, fmt.Sprintf("employee_id = $%d", idx))
		args = append(args, *opts.EmployeeID)
		idx++
	}
	if opts.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, opts.Status)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	items := make([]*domain.PerformanceReview, 0)
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			reviewSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var rv domain.PerformanceReview
			if err := scanReview(rows, &rv); err != nil {
				return err
			}
			items = append(items, &rv)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM performance_review WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

func (s *PerformanceReviewStore) Create(ctx context.Context, in domain.CreateReviewInput, tid uuid.UUID) (*domain.PerformanceReview, error) {
	rv := &domain.PerformanceReview{
		ID:              uuid.New(),
		TenantID:        tid,
		EmployeeID:      in.EmployeeID,
		ReviewPeriod:    in.ReviewPeriod,
		Status:          in.Status,
		OverallRating:   in.OverallRating,
		SelfComments:    in.SelfComments,
		ManagerComments: in.ManagerComments,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}
	if rv.Status == "" {
		rv.Status = domain.ReviewDraft
	}
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO performance_review(id, tenant_id, employee_id, review_period, status,
			                               overall_rating, self_comments, manager_comments,
			                               created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			rv.ID, rv.TenantID, rv.EmployeeID, rv.ReviewPeriod, rv.Status,
			rv.OverallRating, rv.SelfComments, rv.ManagerComments,
			rv.CreatedAt, rv.UpdatedAt,
		)
		return err
	})
	if err != nil {
		return nil, err
	}
	return rv, nil
}

func (s *PerformanceReviewStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.PerformanceReview, error) {
	var rv domain.PerformanceReview
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanReview(tx.QueryRow(ctx, reviewSelect+" WHERE id=$1", id), &rv)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &rv, nil
}

func (s *PerformanceReviewStore) UpdateStatus(ctx context.Context, tid, id uuid.UUID, status domain.ReviewStatus) (*domain.PerformanceReview, error) {
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			"UPDATE performance_review SET status=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2",
			id, tid, status,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetByID(ctx, tid, id)
}

type UpdateReviewInput struct {
	Status          *domain.ReviewStatus `json:"status,omitempty"`
	Score           *int                 `json:"score,omitempty"`
	Comments        *string              `json:"comments,omitempty"`
	ManagerComments *string              `json:"manager_comments,omitempty"`
	ReviewedAt      *time.Time           `json:"reviewed_at,omitempty"`
}

func (s *PerformanceReviewStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdateReviewInput) (*domain.PerformanceReview, error) {
	sets := []string{}
	args := []any{id, tid}
	idx := 3
	if in.Status != nil {
		sets = append(sets, fmt.Sprintf("status=$%d", idx))
		args = append(args, *in.Status)
		idx++
	}
	if in.Score != nil {
		sets = append(sets, fmt.Sprintf("overall_rating=$%d", idx))
		args = append(args, *in.Score)
		idx++
	}
	if in.Comments != nil {
		sets = append(sets, fmt.Sprintf("self_comments=$%d", idx))
		args = append(args, *in.Comments)
		idx++
	}
	if in.ManagerComments != nil {
		sets = append(sets, fmt.Sprintf("manager_comments=$%d", idx))
		args = append(args, *in.ManagerComments)
		idx++
	}
	if len(sets) == 0 {
		return s.GetByID(ctx, tid, id)
	}
	sets = append(sets, "updated_at=now()")
	sql := "UPDATE performance_review SET " + strings.Join(sets, ", ") + " WHERE id=$1 AND tenant_id=$2"
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, sql, args...)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetByID(ctx, tid, id)
}
