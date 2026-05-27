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

type TrainingStore struct{ p *pgxpool.Pool }

func NewTrainingStore(p *pgxpool.Pool) *TrainingStore { return &TrainingStore{p: p} }

const trainingSelect = `
    SELECT id, tenant_id, title, description, trainer, location,
           start_date, end_date, status, max_participants, created_at, updated_at
    FROM training`

func scanTraining(row interface{ Scan(...any) error }, t *domain.Training) error {
	return row.Scan(
		&t.ID, &t.TenantID, &t.Title, &t.Description, &t.Trainer, &t.Location,
		&t.StartDate, &t.EndDate, &t.Status, &t.MaxParticipants,
		&t.CreatedAt, &t.UpdatedAt,
	)
}

type ListTrainingOpts struct {
	Query  string
	Status string
	Limit  int
	Offset int
}

func (s *TrainingStore) List(ctx context.Context, tid uuid.UUID, opts ListTrainingOpts) ([]*domain.Training, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if opts.Query != "" {
		where = append(where, fmt.Sprintf("title ILIKE $%d", idx))
		args = append(args, "%"+opts.Query+"%")
		idx++
	}
	if opts.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, opts.Status)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	items := make([]*domain.Training, 0)
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			trainingSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var t domain.Training
			if err := scanTraining(rows, &t); err != nil {
				return err
			}
			items = append(items, &t)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM training WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

func (s *TrainingStore) Create(ctx context.Context, in domain.CreateTrainingInput, tid uuid.UUID) (*domain.Training, error) {
	t := &domain.Training{
		ID:              uuid.New(),
		TenantID:        tid,
		Title:           in.Title,
		Description:     in.Description,
		Trainer:         in.Trainer,
		Location:        in.Location,
		StartDate:       in.StartDate,
		EndDate:         in.EndDate,
		Status:          in.Status,
		MaxParticipants: in.MaxParticipants,
		CreatedAt:       time.Now(),
		UpdatedAt:       time.Now(),
	}
	if t.Status == "" {
		t.Status = domain.TrainingPlanned
	}
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO training(id, tenant_id, title, description, trainer, location,
			                     start_date, end_date, status, max_participants, created_at, updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			t.ID, t.TenantID, t.Title, t.Description, t.Trainer, t.Location,
			t.StartDate, t.EndDate, t.Status, t.MaxParticipants, t.CreatedAt, t.UpdatedAt,
		)
		return err
	})
	if err != nil {
		return nil, err
	}
	return t, nil
}

func (s *TrainingStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Training, error) {
	var t domain.Training
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanTraining(tx.QueryRow(ctx, trainingSelect+" WHERE id=$1", id), &t)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *TrainingStore) UpdateStatus(ctx context.Context, tid, id uuid.UUID, status domain.TrainingStatus) (*domain.Training, error) {
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			"UPDATE training SET status=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2",
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
