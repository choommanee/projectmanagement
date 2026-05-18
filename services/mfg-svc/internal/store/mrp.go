package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/mfg-svc/internal/domain"
)

// MRP handles MRP run persistence.
type MRP struct{ p *pgxpool.Pool }

func NewMRP(p *pgxpool.Pool) *MRP { return &MRP{p: p} }

func (s *MRP) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
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

func (s *MRP) CreateRun(ctx context.Context, run *domain.MrpRun) error {
	run.ID = uuid.New()
	params, _ := json.Marshal(run.Params)
	return s.withTenant(ctx, run.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO mrp_run(id, tenant_id, name, params, note)
			VALUES ($1,$2,$3,$4,$5)`,
			run.ID, run.TenantID, run.Name, params, run.Note)
		return err
	})
}

func (s *MRP) GetRun(ctx context.Context, tid, id uuid.UUID) (*domain.MrpRun, error) {
	var run domain.MrpRun
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		var params []byte
		err := tx.QueryRow(ctx, `
			SELECT id, tenant_id, name, run_at, params, COALESCE(note,'')
			FROM mrp_run WHERE id = $1`, id).
			Scan(&run.ID, &run.TenantID, &run.Name, &run.RunAt, &params, &run.Note)
		if err != nil {
			return err
		}
		if len(params) > 0 {
			_ = json.Unmarshal(params, &run.Params)
		}
		if run.Params == nil {
			run.Params = map[string]any{}
		}
		return nil
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &run, nil
}

func (s *MRP) ListRuns(ctx context.Context, tid uuid.UUID, limit int) ([]*domain.MrpRun, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var list []*domain.MrpRun
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, name, run_at, params, COALESCE(note,'')
			FROM mrp_run WHERE tenant_id = $1 ORDER BY run_at DESC LIMIT $2`, tid, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var run domain.MrpRun
			var params []byte
			if err := rows.Scan(&run.ID, &run.TenantID, &run.Name, &run.RunAt, &params, &run.Note); err != nil {
				return err
			}
			if len(params) > 0 {
				_ = json.Unmarshal(params, &run.Params)
			}
			if run.Params == nil {
				run.Params = map[string]any{}
			}
			list = append(list, &run)
		}
		return rows.Err()
	})
	return list, err
}

func (s *MRP) RunSummary(ctx context.Context, tid, runID uuid.UUID) (*domain.MrpRunSummary, error) {
	run, err := s.GetRun(ctx, tid, runID)
	if err != nil {
		return nil, err
	}
	var summary domain.MrpRunSummary
	summary.Run = run
	err = s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		_ = tx.QueryRow(ctx, `SELECT count(*) FROM mrp_demand WHERE run_id = $1`, runID).Scan(&summary.Demands)
		_ = tx.QueryRow(ctx, `SELECT count(*) FROM mrp_supply WHERE run_id = $1`, runID).Scan(&summary.Supplies)
		_ = tx.QueryRow(ctx, `SELECT count(*) FROM mrp_action WHERE run_id = $1`, runID).Scan(&summary.Actions)
		return nil
	})
	return &summary, err
}

func (s *MRP) SaveDemands(ctx context.Context, tid uuid.UUID, demands []*domain.MrpDemand) error {
	if len(demands) == 0 {
		return nil
	}
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		for _, d := range demands {
			d.ID = uuid.New()
			_, err := tx.Exec(ctx, `
				INSERT INTO mrp_demand(id, tenant_id, run_id, item_id, qty, due_date, source, source_ref)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
				d.ID, d.TenantID, d.RunID, d.ItemID, d.Qty, d.DueDate, d.Source, d.SourceRef)
			if err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *MRP) SaveSupplies(ctx context.Context, tid uuid.UUID, supplies []*domain.MrpSupply) error {
	if len(supplies) == 0 {
		return nil
	}
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		for _, sup := range supplies {
			sup.ID = uuid.New()
			_, err := tx.Exec(ctx, `
				INSERT INTO mrp_supply(id, tenant_id, run_id, item_id, qty, available_at, source, source_ref)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
				sup.ID, sup.TenantID, sup.RunID, sup.ItemID, sup.Qty, sup.AvailableAt, sup.Source, sup.SourceRef)
			if err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *MRP) SaveActions(ctx context.Context, tid uuid.UUID, actions []*domain.MrpAction) error {
	if len(actions) == 0 {
		return nil
	}
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		for _, a := range actions {
			a.ID = uuid.New()
			_, err := tx.Exec(ctx, `
				INSERT INTO mrp_action(id, tenant_id, run_id, action, entity_type, entity_id, message)
				VALUES ($1,$2,$3,$4,$5,$6,$7)`,
				a.ID, a.TenantID, a.RunID, a.Action, a.EntityType, a.EntityID, a.Message)
			if err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *MRP) ListDemands(ctx context.Context, tid, runID uuid.UUID) ([]*domain.MrpDemand, error) {
	var list []*domain.MrpDemand
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, run_id, item_id, qty, due_date, source, COALESCE(source_ref,'')
			FROM mrp_demand WHERE run_id = $1`, runID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var d domain.MrpDemand
			if err := rows.Scan(&d.ID, &d.TenantID, &d.RunID, &d.ItemID, &d.Qty, &d.DueDate, &d.Source, &d.SourceRef); err != nil {
				return err
			}
			list = append(list, &d)
		}
		return rows.Err()
	})
	return list, err
}

func (s *MRP) ListSupplies(ctx context.Context, tid, runID uuid.UUID) ([]*domain.MrpSupply, error) {
	var list []*domain.MrpSupply
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, run_id, item_id, qty, available_at, source, COALESCE(source_ref,'')
			FROM mrp_supply WHERE run_id = $1`, runID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var sup domain.MrpSupply
			if err := rows.Scan(&sup.ID, &sup.TenantID, &sup.RunID, &sup.ItemID, &sup.Qty, &sup.AvailableAt, &sup.Source, &sup.SourceRef); err != nil {
				return err
			}
			list = append(list, &sup)
		}
		return rows.Err()
	})
	return list, err
}

func (s *MRP) ListActions(ctx context.Context, tid, runID uuid.UUID) ([]*domain.MrpAction, error) {
	var list []*domain.MrpAction
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, run_id, action, entity_type, entity_id, COALESCE(message,'')
			FROM mrp_action WHERE run_id = $1`, runID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var a domain.MrpAction
			if err := rows.Scan(&a.ID, &a.TenantID, &a.RunID, &a.Action, &a.EntityType, &a.EntityID, &a.Message); err != nil {
				return err
			}
			list = append(list, &a)
		}
		return rows.Err()
	})
	return list, err
}
