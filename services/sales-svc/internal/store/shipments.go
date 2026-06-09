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

type ShipmentStore struct{ p *pgxpool.Pool }

func NewShipmentStore(p *pgxpool.Pool) *ShipmentStore { return &ShipmentStore{p: p} }

const shipmentSelect = `
    SELECT id, tenant_id, code, so_id, customer_id, ship_date,
           carrier, tracking_no, delivery_address, status, notes, created_at, updated_at
    FROM shipment`

func scanShipment(row interface{ Scan(...any) error }, s *domain.Shipment) error {
	return row.Scan(
		&s.ID, &s.TenantID, &s.Code, &s.SOID, &s.CustomerID, &s.ShipDate,
		&s.Carrier, &s.TrackingNo, &s.DeliveryAddress, &s.Status, &s.Notes,
		&s.CreatedAt, &s.UpdatedAt,
	)
}

func (st *ShipmentStore) Create(ctx context.Context, s *domain.Shipment) error {
	s.ID = uuid.New()
	s.CreatedAt = time.Now()
	s.UpdatedAt = s.CreatedAt
	if s.Status == "" {
		s.Status = domain.ShipmentPending
	}
	return withTenant(ctx, st.p, s.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO shipment(id, tenant_id, code, so_id, customer_id, ship_date,
			                     carrier, tracking_no, delivery_address, status, notes)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			s.ID, s.TenantID, s.Code, s.SOID, s.CustomerID, s.ShipDate,
			s.Carrier, s.TrackingNo, s.DeliveryAddress, s.Status, s.Notes,
		)
		return err
	})
}

func (st *ShipmentStore) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.Shipment, error) {
	var s domain.Shipment
	err := withTenant(ctx, st.p, tid, func(tx pgx.Tx) error {
		return scanShipment(tx.QueryRow(ctx, shipmentSelect+" WHERE id=$1", id), &s)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

type ListShipmentOpts struct {
	Status string
	Limit  int
	Offset int
}

func (st *ShipmentStore) List(ctx context.Context, tid uuid.UUID, opts ListShipmentOpts) ([]*domain.Shipment, int, error) {
	if opts.Limit <= 0 || opts.Limit > 500 {
		opts.Limit = 100
	}
	where := []string{"tenant_id = $1"}
	args := []any{tid}
	idx := 2
	if opts.Status != "" {
		where = append(where, fmt.Sprintf("status = $%d", idx))
		args = append(args, opts.Status)
		idx++
	}
	whereSQL := strings.Join(where, " AND ")

	var items []*domain.Shipment
	var total int
	err := withTenant(ctx, st.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			shipmentSelect+" WHERE "+whereSQL+
				fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var s domain.Shipment
			if err := scanShipment(rows, &s); err != nil {
				return err
			}
			items = append(items, &s)
		}
		if rows.Err() != nil {
			return rows.Err()
		}
		return tx.QueryRow(ctx, "SELECT count(*) FROM shipment WHERE "+whereSQL, args...).Scan(&total)
	})
	return items, total, err
}

type UpdateShipmentInput struct {
	Status          domain.ShipmentStatus
	Carrier         string
	TrackingNo      string
	DeliveryAddress string
	ShipDate        *time.Time
	Notes           string
}

func (st *ShipmentStore) Update(ctx context.Context, tid, id uuid.UUID, in UpdateShipmentInput) (*domain.Shipment, error) {
	var s domain.Shipment
	err := withTenant(ctx, st.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx, `
			UPDATE shipment
			SET status=$3, carrier=$4, tracking_no=$5, delivery_address=$6,
			    ship_date=$7, notes=$8, updated_at=now()
			WHERE id=$1 AND tenant_id=$2`,
			id, tid, in.Status, in.Carrier, in.TrackingNo, in.DeliveryAddress,
			in.ShipDate, in.Notes,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return scanShipment(tx.QueryRow(ctx, shipmentSelect+" WHERE id=$1", id), &s)
	})
	if errors.Is(err, domain.ErrNotFound) {
		return nil, err
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// UpdateStatus mutates only the shipment status. Returns ErrNotFound when absent.
func (st *ShipmentStore) UpdateStatus(ctx context.Context, tid, id uuid.UUID, status domain.ShipmentStatus) (*domain.Shipment, error) {
	var s domain.Shipment
	err := withTenant(ctx, st.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			`UPDATE shipment SET status=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2`,
			id, tid, status,
		)
		if err != nil {
			return err
		}
		if ct.RowsAffected() == 0 {
			return domain.ErrNotFound
		}
		return scanShipment(tx.QueryRow(ctx, shipmentSelect+" WHERE id=$1", id), &s)
	})
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// Delete hard-deletes a shipment. Returns ErrNotFound when absent.
func (st *ShipmentStore) Delete(ctx context.Context, tid, id uuid.UUID) error {
	return withTenant(ctx, st.p, tid, func(tx pgx.Tx) error {
		ct, err := tx.Exec(ctx,
			`DELETE FROM shipment WHERE id=$1 AND tenant_id=$2`,
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
