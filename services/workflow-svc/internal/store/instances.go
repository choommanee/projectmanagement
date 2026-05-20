package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/workflow-svc/internal/domain"
)

type Instances struct{ p *pgxpool.Pool }

func NewInstances(p *pgxpool.Pool) *Instances { return &Instances{p: p} }

func (s *Instances) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
	return (&Definitions{p: s.p}).withTenant(ctx, tid, fn)
}

func (s *Instances) Create(ctx context.Context, inst *domain.WorkflowInstance) error {
	input := inst.Input
	if input == nil {
		input = json.RawMessage(`{}`)
	}
	vars := inst.Variables
	if vars == nil {
		vars = json.RawMessage(`{}`)
	}
	return s.withTenant(ctx, inst.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO workflow_instance(id, tenant_id, definition_id, version_id, status, input, variables, trigger_kind)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			inst.ID, inst.TenantID, inst.DefinitionID, inst.VersionID,
			inst.Status, input, vars, inst.TriggerKind)
		return err
	})
}

func (s *Instances) GetByID(ctx context.Context, tid, id uuid.UUID) (*domain.WorkflowInstance, error) {
	var inst domain.WorkflowInstance
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return scanInstance(tx.QueryRow(ctx,
			instanceSelect+" WHERE id=$1 AND tenant_id=$2", id, tid), &inst)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &inst, nil
}

type ListInstancesOpts struct {
	Status string
	Limit  int
	Offset int
}

func (s *Instances) ListByDefinition(ctx context.Context, tid, defID uuid.UUID, opts ListInstancesOpts) ([]*domain.WorkflowInstance, int, error) {
	if opts.Limit <= 0 || opts.Limit > 200 {
		opts.Limit = 50
	}
	where := fmt.Sprintf("tenant_id = $1 AND definition_id = $2")
	args := []any{tid, defID}
	idx := 3

	if opts.Status != "" {
		where += fmt.Sprintf(" AND status = $%d", idx)
		args = append(args, opts.Status)
		idx++
	}

	var items []*domain.WorkflowInstance
	var total int
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			instanceSelect+" WHERE "+where+
				fmt.Sprintf(" ORDER BY started_at DESC LIMIT $%d OFFSET $%d", idx, idx+1),
			append(args, opts.Limit, opts.Offset)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var inst domain.WorkflowInstance
			if err := scanInstance(rows, &inst); err != nil {
				return err
			}
			items = append(items, &inst)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		return tx.QueryRow(ctx,
			"SELECT count(*) FROM workflow_instance WHERE "+where, args...).Scan(&total)
	})
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// UpdateStateAndSteps atomically updates the instance and bulk-inserts step_executions + human_tasks.
func (s *Instances) UpdateStateAndSteps(
	ctx context.Context,
	tid uuid.UUID,
	inst *domain.WorkflowInstance,
	steps []domain.StepExecution,
	humanTasks []domain.HumanTask,
) error {
	return s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		// Update instance
		var endedAt *time.Time
		if inst.Status == domain.InstanceCompleted || inst.Status == domain.InstanceFailed || inst.Status == domain.InstanceCancelled {
			now := time.Now()
			endedAt = &now
		}
		_, err := tx.Exec(ctx, `
			UPDATE workflow_instance SET
			  status=$2, output=$3, variables=$4, cursor=$5, error=$6, ended_at=$7
			WHERE id=$1 AND tenant_id=$8`,
			inst.ID, inst.Status, inst.Output, inst.Variables, inst.Cursor, inst.Error, endedAt, tid)
		if err != nil {
			return err
		}
		inst.EndedAt = endedAt

		// Bulk insert step executions
		for _, se := range steps {
			_, err := tx.Exec(ctx, `
				INSERT INTO step_execution(id, tenant_id, instance_id, step_id, step_type, status, input, output, error)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
				se.ID, tid, inst.ID, se.StepID, se.StepType, se.Status, se.Input, se.Output, se.Error)
			if err != nil {
				return err
			}
		}

		// Bulk insert human tasks
		for _, ht := range humanTasks {
			assigneeStr := ""
			if ht.AssigneeID != nil {
				assigneeStr = ht.AssigneeID.String()
			}
			// Try to parse assignee as UUID or leave nil
			var assigneeID *uuid.UUID
			if assigneeStr != "" {
				if aid, err := uuid.Parse(assigneeStr); err == nil {
					assigneeID = &aid
				}
			}
			form := ht.Form
			if form == nil {
				form = json.RawMessage(`{}`)
			}
			_, err := tx.Exec(ctx, `
				INSERT INTO human_task(id, tenant_id, instance_id, step_id, assignee_id, form)
				VALUES ($1,$2,$3,$4,$5,$6)`,
				ht.ID, tid, inst.ID, ht.StepID, assigneeID, form)
			if err != nil {
				return err
			}
		}

		return nil
	})
}

func (s *Instances) ListSteps(ctx context.Context, tid, instanceID uuid.UUID) ([]*domain.StepExecution, error) {
	var items []*domain.StepExecution
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, tenant_id, instance_id, step_id, step_type, status, input, output, error, started_at, ended_at
			FROM step_execution
			WHERE instance_id=$1 AND tenant_id=$2
			ORDER BY started_at ASC`, instanceID, tid)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var se domain.StepExecution
			if err := rows.Scan(&se.ID, &se.TenantID, &se.InstanceID, &se.StepID, &se.StepType,
				&se.Status, &se.Input, &se.Output, &se.Error, &se.StartedAt, &se.EndedAt); err != nil {
				return err
			}
			items = append(items, &se)
		}
		return rows.Err()
	})
	return items, err
}

const instanceSelect = `
    SELECT id, tenant_id, definition_id, version_id, status, input, output, variables,
           cursor, error, trigger_kind, started_at, ended_at
    FROM workflow_instance`

func scanInstance(r rowScanner, inst *domain.WorkflowInstance) error {
	return r.Scan(
		&inst.ID, &inst.TenantID, &inst.DefinitionID, &inst.VersionID,
		&inst.Status, &inst.Input, &inst.Output, &inst.Variables,
		&inst.Cursor, &inst.Error, &inst.TriggerKind, &inst.StartedAt, &inst.EndedAt)
}
