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

	"github.com/pmplatform/services/quality-svc/internal/domain"
)

type FMEAStore struct{ p *pgxpool.Pool }

func NewFMEA(p *pgxpool.Pool) *FMEAStore { return &FMEAStore{p: p} }

const fmeaSelect = `
    SELECT id, tenant_id, type, item_id, name, team, status, created_at, updated_at, version
    FROM fmea`

func scanFMEA(row interface{ Scan(...any) error }, f *domain.FMEA) error {
	return row.Scan(&f.ID, &f.TenantID, &f.Type, &f.ItemID, &f.Name, &f.Team, &f.Status,
		&f.CreatedAt, &f.UpdatedAt, &f.Version)
}

func (s *FMEAStore) Create(ctx context.Context, f *domain.FMEA) error {
	f.ID = uuid.New()
	f.CreatedAt = time.Now()
	f.UpdatedAt = f.CreatedAt
	f.Version = 1
	if f.Status == "" {
		f.Status = domain.APQPStatusNotStarted
	}
	if f.Team == nil {
		f.Team = []string{}
	}
	return withTenant(ctx, s.p, f.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO fmea(id, tenant_id, type, item_id, name, team, status, version)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			f.ID, f.TenantID, f.Type, f.ItemID, f.Name, f.Team, f.Status, f.Version)
		return err
	})
}

func (s *FMEAStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.FMEA, error) {
	var f domain.FMEA
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		return scanFMEA(tx.QueryRow(ctx, fmeaSelect+" WHERE id=$1", id), &f)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &f, nil
}

type ListFMEAOpts struct {
	ItemID *uuid.UUID
	Type   string
	Limit  int
	Offset int
}

func (s *FMEAStore) List(ctx context.Context, tid uuid.UUID, opts ListFMEAOpts) ([]*domain.FMEA, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if opts.ItemID != nil {
		where = append(where, fmt.Sprintf("item_id = $%d", idx))
		args = append(args, *opts.ItemID)
		idx++
	}
	if opts.Type != "" {
		where = append(where, fmt.Sprintf("type = $%d", idx))
		args = append(args, opts.Type)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.FMEA
	var total int
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			fmeaSelect+" WHERE "+whereSQL+fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var f domain.FMEA
			if err := scanFMEA(rows, &f); err != nil {
				return err
			}
			items = append(items, &f)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM fmea WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdateFMEAInput struct {
	Name    string
	Status  domain.APQPStatus
	Team    []string
	Version int
}

func (s *FMEAStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdateFMEAInput) (*domain.FMEA, error) {
	var f domain.FMEA
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE fmea SET name=$3, status=$4, team=$5, updated_at=now(), version=version+1
			WHERE id=$1 AND tenant_id=$2 AND version=$6`,
			id, tid, in.Name, in.Status, in.Team, in.Version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return scanFMEA(tx.QueryRow(ctx, fmeaSelect+" WHERE id=$1", id), &f)
	})
	if err != nil {
		return nil, err
	}
	return &f, nil
}

func (s *FMEAStore) Delete(ctx context.Context, tid, id uuid.UUID, version int) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `DELETE FROM fmea WHERE id=$1 AND tenant_id=$2 AND version=$3`, id, tid, version)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrConflict
		}
		return nil
	})
}

const fmModeSelect = `
    SELECT id, tenant_id, fmea_id, function, failure_mode, COALESCE(effect,''),
           severity, COALESCE(cause,''), occurrence, detection, rpn,
           COALESCE(actions,''), target_date, sort_order
    FROM fmea_failure_mode`

func scanFMMode(row interface{ Scan(...any) error }, m *domain.FMEAFailureMode) error {
	return row.Scan(&m.ID, &m.TenantID, &m.FMEAID, &m.Function, &m.FailureMode, &m.Effect,
		&m.Severity, &m.Cause, &m.Occurrence, &m.Detection, &m.RPN,
		&m.Actions, &m.TargetDate, &m.SortOrder)
}

func (s *FMEAStore) AddFailureMode(ctx context.Context, m *domain.FMEAFailureMode) error {
	m.ID = uuid.New()
	return withTenant(ctx, s.p, m.TenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			INSERT INTO fmea_failure_mode(id, tenant_id, fmea_id, function, failure_mode,
			                             effect, severity, cause, occurrence, detection, actions, target_date, sort_order)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
			RETURNING rpn`,
			m.ID, m.TenantID, m.FMEAID, m.Function, m.FailureMode,
			m.Effect, m.Severity, m.Cause, m.Occurrence, m.Detection,
			m.Actions, m.TargetDate, m.SortOrder).Scan(&m.RPN)
	})
}

func (s *FMEAStore) ListFailureModes(ctx context.Context, tid, fmeaID uuid.UUID) ([]*domain.FMEAFailureMode, error) {
	var list []*domain.FMEAFailureMode
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, fmModeSelect+" WHERE fmea_id=$1 ORDER BY sort_order, id", fmeaID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var m domain.FMEAFailureMode
			if err := scanFMMode(rows, &m); err != nil {
				return err
			}
			list = append(list, &m)
		}
		return rows.Err()
	})
	return list, err
}

type UpdateFMEAModeInput struct {
	Function    string
	FailureMode string
	Effect      string
	Severity    int
	Cause       string
	Occurrence  int
	Detection   int
	Actions     string
	TargetDate  *time.Time
	SortOrder   int
}

func (s *FMEAStore) UpdateFailureMode(ctx context.Context, tid, id uuid.UUID, in UpdateFMEAModeInput) (*domain.FMEAFailureMode, error) {
	var m domain.FMEAFailureMode
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE fmea_failure_mode SET function=$3, failure_mode=$4, effect=$5, severity=$6,
			       cause=$7, occurrence=$8, detection=$9, actions=$10, target_date=$11, sort_order=$12
			WHERE id=$1 AND tenant_id=$2`,
			id, tid, in.Function, in.FailureMode, in.Effect, in.Severity,
			in.Cause, in.Occurrence, in.Detection, in.Actions, in.TargetDate, in.SortOrder)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return scanFMMode(tx.QueryRow(ctx, fmModeSelect+" WHERE id=$1", id), &m)
	})
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (s *FMEAStore) DeleteFailureMode(ctx context.Context, tid, id uuid.UUID) error {
	return withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `DELETE FROM fmea_failure_mode WHERE id=$1 AND tenant_id=$2`, id, tid)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return nil
	})
}
