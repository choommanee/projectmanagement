package store

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/reports-svc/internal/domain"
)

type Metrics struct{ p *pgxpool.Pool }

func NewMetrics(p *pgxpool.Pool) *Metrics { return &Metrics{p: p} }

func (s *Metrics) withTenantTx(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
	tx, err := s.p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String())); err != nil {
		return err
	}
	return fn(tx)
}

// safeCount runs a query and returns 0 on error (table might not exist or be empty).
//
// Each count is executed inside its own savepoint (nested tx). Without this, a
// single failing query — e.g. against a table that has not been migrated yet —
// would put the surrounding transaction into an aborted state, causing EVERY
// subsequent count in Summary to fail with "current transaction is aborted" and
// silently return 0. Isolating each query in a savepoint means one missing
// table degrades only its own metric, not all metrics after it.
func safeCount(ctx context.Context, tx pgx.Tx, query string, args ...any) int {
	sp, err := tx.Begin(ctx) // pgx: nested Begin == SAVEPOINT
	if err != nil {
		return 0
	}
	var n int
	if scanErr := sp.QueryRow(ctx, query, args...).Scan(&n); scanErr != nil {
		_ = sp.Rollback(ctx) // ROLLBACK TO SAVEPOINT — keeps outer tx usable
		return 0
	}
	_ = sp.Commit(ctx) // RELEASE SAVEPOINT
	return n
}

func (s *Metrics) Summary(ctx context.Context, tid uuid.UUID) (*domain.SummaryMetrics, error) {
	var m domain.SummaryMetrics
	err := s.withTenantTx(ctx, tid, func(tx pgx.Tx) error {
		// Projects
		m.Projects.Total = safeCount(ctx, tx, `SELECT count(*) FROM project WHERE tenant_id=$1 AND deleted_at IS NULL`, tid)
		m.Projects.Active = safeCount(ctx, tx, `SELECT count(*) FROM project WHERE tenant_id=$1 AND status='active' AND deleted_at IS NULL`, tid)
		m.Projects.Completed = safeCount(ctx, tx, `SELECT count(*) FROM project WHERE tenant_id=$1 AND status='completed' AND deleted_at IS NULL`, tid)
		m.Projects.Planning = safeCount(ctx, tx, `SELECT count(*) FROM project WHERE tenant_id=$1 AND status='planning' AND deleted_at IS NULL`, tid)

		// Tasks
		m.Tasks.Total = safeCount(ctx, tx, `SELECT count(*) FROM task WHERE tenant_id=$1 AND deleted_at IS NULL`, tid)
		m.Tasks.Open = safeCount(ctx, tx, `SELECT count(*) FROM task WHERE tenant_id=$1 AND status IN ('todo','in_progress','blocked','review') AND deleted_at IS NULL`, tid)
		m.Tasks.Done = safeCount(ctx, tx, `SELECT count(*) FROM task WHERE tenant_id=$1 AND status='done' AND deleted_at IS NULL`, tid)
		m.Tasks.Overdue = safeCount(ctx, tx, `SELECT count(*) FROM task WHERE tenant_id=$1 AND due_date < now() AND status NOT IN ('done','cancelled') AND deleted_at IS NULL`, tid)

		// Work orders
		m.WorkOrders.Total = safeCount(ctx, tx, `SELECT count(*) FROM work_order WHERE tenant_id=$1`, tid)
		m.WorkOrders.Planned = safeCount(ctx, tx, `SELECT count(*) FROM work_order WHERE tenant_id=$1 AND status='planned'`, tid)
		m.WorkOrders.Released = safeCount(ctx, tx, `SELECT count(*) FROM work_order WHERE tenant_id=$1 AND status='released'`, tid)
		m.WorkOrders.InProgress = safeCount(ctx, tx, `SELECT count(*) FROM work_order WHERE tenant_id=$1 AND status='in_progress'`, tid)
		m.WorkOrders.Completed = safeCount(ctx, tx, `SELECT count(*) FROM work_order WHERE tenant_id=$1 AND status='completed'`, tid)

		// NCRs (nonconformance): open = not yet resolved (open + investigating)
		m.NcrsOpen = safeCount(ctx, tx, `SELECT count(*) FROM nonconformance WHERE tenant_id=$1 AND status NOT IN ('closed','corrected')`, tid)

		// FMEA high RPN (rpn > 100)
		m.FmeaHighRpn = safeCount(ctx, tx, `SELECT count(*) FROM fmea_failure_mode WHERE tenant_id=$1 AND rpn > 100`, tid)

		// Documents
		m.Documents.Total = safeCount(ctx, tx, `SELECT count(*) FROM document WHERE tenant_id=$1 AND deleted_at IS NULL`, tid)
		m.Documents.Draft = safeCount(ctx, tx, `SELECT count(*) FROM document WHERE tenant_id=$1 AND status='draft' AND deleted_at IS NULL`, tid)
		m.Documents.Approved = safeCount(ctx, tx, `SELECT count(*) FROM document WHERE tenant_id=$1 AND status='approved' AND deleted_at IS NULL`, tid)

		// Workflow runs today
		m.WorkflowRunsToday = safeCount(ctx, tx, `SELECT count(*) FROM workflow_instance WHERE tenant_id=$1 AND started_at >= current_date`, tid)

		// Audit events 24h
		m.AuditEvents24h = safeCount(ctx, tx, `SELECT count(*) FROM audit_log WHERE tenant_id=$1 AND ts > now() - interval '24 hours'`, tid)

		return nil
	})
	return &m, err
}

func (s *Metrics) Timeseries(ctx context.Context, tid uuid.UUID, metric string, days int) ([]domain.TimeseriesPoint, error) {
	if days <= 0 || days > 365 {
		days = 14
	}

	var query string
	switch metric {
	case "audit_events":
		query = fmt.Sprintf(`
			SELECT date_trunc('day', ts)::date::text AS day, count(*)::int AS cnt
			FROM audit_log
			WHERE tenant_id='%s' AND ts > now() - interval '%d days'
			GROUP BY day ORDER BY day`, tid.String(), days)
	case "workflow_runs":
		query = fmt.Sprintf(`
			SELECT date_trunc('day', started_at)::date::text AS day, count(*)::int AS cnt
			FROM workflow_instance
			WHERE tenant_id='%s' AND started_at > now() - interval '%d days'
			GROUP BY day ORDER BY day`, tid.String(), days)
	case "task_throughput":
		query = fmt.Sprintf(`
			SELECT date_trunc('day', updated_at)::date::text AS day, count(*)::int AS cnt
			FROM task
			WHERE tenant_id='%s' AND status='done' AND updated_at > now() - interval '%d days' AND deleted_at IS NULL
			GROUP BY day ORDER BY day`, tid.String(), days)
	case "wo_releases":
		query = fmt.Sprintf(`
			SELECT date_trunc('day', updated_at)::date::text AS day, count(*)::int AS cnt
			FROM work_order
			WHERE tenant_id='%s' AND status='released' AND updated_at > now() - interval '%d days'
			GROUP BY day ORDER BY day`, tid.String(), days)
	default:
		return []domain.TimeseriesPoint{}, nil
	}

	rows, err := s.p.Query(ctx, query)
	if err != nil {
		// table might not exist — return empty
		return []domain.TimeseriesPoint{}, nil
	}
	defer rows.Close()

	var points []domain.TimeseriesPoint
	for rows.Next() {
		var p domain.TimeseriesPoint
		if err := rows.Scan(&p.Day, &p.Count); err != nil {
			continue
		}
		points = append(points, p)
	}
	if points == nil {
		points = []domain.TimeseriesPoint{}
	}
	return points, nil
}

func (s *Metrics) ByStatus(ctx context.Context, tid uuid.UUID, metric string) ([]domain.ByStatusPoint, error) {
	var query string
	switch metric {
	case "projects":
		query = fmt.Sprintf(`SELECT status::text, count(*)::int FROM project WHERE tenant_id='%s' AND deleted_at IS NULL GROUP BY status ORDER BY status`, tid.String())
	case "tasks":
		query = fmt.Sprintf(`SELECT status::text, count(*)::int FROM task WHERE tenant_id='%s' AND deleted_at IS NULL GROUP BY status ORDER BY status`, tid.String())
	case "work_orders":
		query = fmt.Sprintf(`SELECT status::text, count(*)::int FROM work_order WHERE tenant_id='%s' GROUP BY status ORDER BY status`, tid.String())
	case "ncrs":
		query = fmt.Sprintf(`SELECT status::text, count(*)::int FROM nonconformance WHERE tenant_id='%s' GROUP BY status ORDER BY status`, tid.String())
	case "documents":
		query = fmt.Sprintf(`SELECT status::text, count(*)::int FROM document WHERE tenant_id='%s' AND deleted_at IS NULL GROUP BY status ORDER BY status`, tid.String())
	default:
		return []domain.ByStatusPoint{}, nil
	}

	rows, err := s.p.Query(ctx, query)
	if err != nil {
		return []domain.ByStatusPoint{}, nil
	}
	defer rows.Close()

	var points []domain.ByStatusPoint
	for rows.Next() {
		var p domain.ByStatusPoint
		if err := rows.Scan(&p.Status, &p.Count); err != nil {
			continue
		}
		points = append(points, p)
	}
	if points == nil {
		points = []domain.ByStatusPoint{}
	}
	return points, nil
}

