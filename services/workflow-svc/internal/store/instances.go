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
		// RETURNING populates the DB-assigned timestamp so the create/start
		// response carries the real started_at (not the zero value).
		return tx.QueryRow(ctx, `
			INSERT INTO workflow_instance(id, tenant_id, definition_id, version_id, status, input, variables, trigger_kind)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			RETURNING started_at`,
			inst.ID, inst.TenantID, inst.DefinitionID, inst.VersionID,
			inst.Status, input, vars, inst.TriggerKind).Scan(&inst.StartedAt)
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

// ListAll returns instances across ALL workflow definitions for a tenant,
// newest first, with optional status filter and pagination. Powers the
// tenant-wide run-history view (GET /v1/instances).
func (s *Instances) ListAll(ctx context.Context, tid uuid.UUID, opts ListInstancesOpts) ([]*domain.WorkflowInstance, int, error) {
	if opts.Limit <= 0 || opts.Limit > 200 {
		opts.Limit = 50
	}
	where := "tenant_id = $1"
	args := []any{tid}
	idx := 2

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
		// Clear wake_at unless the instance is paused with a pending timer.
		wakeAt := inst.WakeAt
		if inst.Status != domain.InstancePaused {
			wakeAt = nil
			inst.WakeAt = nil
		}
		_, err := tx.Exec(ctx, `
			UPDATE workflow_instance SET
			  status=$2, output=$3, variables=$4, cursor=$5, error=$6, ended_at=$7, wake_at=$9,
			  pending_envelope_id=$10
			WHERE id=$1 AND tenant_id=$8`,
			inst.ID, inst.Status, inst.Output, inst.Variables, inst.Cursor, inst.Error, endedAt, tid, wakeAt,
			inst.PendingEnvelopeID)
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
				INSERT INTO human_task(id, tenant_id, instance_id, step_id, assignee_id, form, sla_deadline)
				VALUES ($1,$2,$3,$4,$5,$6,$7)`,
				ht.ID, tid, inst.ID, ht.StepID, assigneeID, form, ht.SLADeadline)
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
           cursor, error, trigger_kind, started_at, ended_at, wake_at, pending_envelope_id
    FROM workflow_instance`

func scanInstance(r rowScanner, inst *domain.WorkflowInstance) error {
	return r.Scan(
		&inst.ID, &inst.TenantID, &inst.DefinitionID, &inst.VersionID,
		&inst.Status, &inst.Input, &inst.Output, &inst.Variables,
		&inst.Cursor, &inst.Error, &inst.TriggerKind, &inst.StartedAt, &inst.EndedAt, &inst.WakeAt,
		&inst.PendingEnvelopeID)
}

// FindPausedByEnvelope returns the paused instance awaiting the given signature
// envelope within a tenant, or ErrNotFound. The lookup is tenant-scoped via RLS
// (callers wrap with the tenant from the document-svc event payload).
func (s *Instances) FindPausedByEnvelope(ctx context.Context, tid, envelopeID uuid.UUID) (*domain.WorkflowInstance, error) {
	var inst domain.WorkflowInstance
	err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
		return scanInstance(tx.QueryRow(ctx,
			instanceSelect+" WHERE tenant_id=$1 AND pending_envelope_id=$2 AND status='paused'",
			tid, envelopeID), &inst)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &inst, nil
}

// DueWake is a minimal projection of instances whose timer has elapsed.
type DueWake struct {
	TenantID   uuid.UUID
	InstanceID uuid.UUID
}

// PendingSignature is a minimal projection of paused instances awaiting a
// signature envelope outcome.
type PendingSignature struct {
	TenantID   uuid.UUID
	InstanceID uuid.UUID
	EnvelopeID uuid.UUID
}

// FindPendingSignatures returns up to `limit` paused instances that have a
// pending_envelope_id set, across ALL tenants. Like FindDueWakes, this is
// called by a background poller that runs without a tenant context, so it
// deliberately runs OUTSIDE the RLS helper and exposes only the identifiers
// the poller needs to re-enter the tenant-scoped ResumeBySignature path.
func (s *Instances) FindPendingSignatures(ctx context.Context, limit int) ([]PendingSignature, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.p.Query(ctx, `
		SELECT tenant_id, id, pending_envelope_id FROM workflow_instance
		WHERE status = 'paused' AND pending_envelope_id IS NOT NULL
		ORDER BY started_at ASC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PendingSignature
	for rows.Next() {
		var ps PendingSignature
		if err := rows.Scan(&ps.TenantID, &ps.InstanceID, &ps.EnvelopeID); err != nil {
			return nil, err
		}
		out = append(out, ps)
	}
	return out, rows.Err()
}

// FindDueWakes returns up to `limit` paused instances whose wake_at has elapsed,
// across ALL tenants. This is called by the background poller, which must run
// without a tenant context, so it deliberately runs OUTSIDE the RLS helper.
// It only exposes (tenant_id, instance_id) so the poller can re-enter the
// normal tenant-scoped resume path.
func (s *Instances) FindDueWakes(ctx context.Context, limit int) ([]DueWake, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.p.Query(ctx, `
		SELECT tenant_id, id FROM workflow_instance
		WHERE status = 'paused' AND wake_at IS NOT NULL AND wake_at <= now()
		ORDER BY wake_at ASC
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DueWake
	for rows.Next() {
		var d DueWake
		if err := rows.Scan(&d.TenantID, &d.InstanceID); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}
