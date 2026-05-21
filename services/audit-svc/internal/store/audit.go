package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pmplatform/services/audit-svc/internal/domain"
)

// ListOpts defines filter/pagination parameters for listing audit events.
type ListOpts struct {
	Service    string
	Action     string
	EntityType string
	EntityID   string
	UserID     string
	Result     string
	Q          string     // full-text search in action + entity_id + meta::text
	From       *time.Time
	To         *time.Time
	Limit      int
	Offset     int
}

// Store wraps a pgxpool for audit_log queries.
type Store struct {
	p *pgxpool.Pool
}

// New creates a new audit Store.
func New(p *pgxpool.Pool) *Store {
	return &Store{p: p}
}

// withTenant opens a transaction with SET LOCAL app.current_tenant for RLS.
func withTenant(ctx context.Context, p *pgxpool.Pool, tid uuid.UUID, fn func(pgx.Tx) error) error {
	tx, err := p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String())); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// scanEvent reads one row into a domain.Event.
func scanEvent(row pgx.Row) (domain.Event, error) {
	var ev domain.Event
	var beforeRaw, afterRaw, metaRaw []byte
	if err := row.Scan(
		&ev.ID, &ev.Timestamp, &ev.TenantID, &ev.UserID,
		&ev.Service, &ev.Action, &ev.EntityType, &ev.EntityID,
		&ev.IP, &ev.Result, &beforeRaw, &afterRaw, &metaRaw,
	); err != nil {
		return domain.Event{}, err
	}
	if len(beforeRaw) > 0 && string(beforeRaw) != "null" {
		_ = json.Unmarshal(beforeRaw, &ev.Before)
	}
	if len(afterRaw) > 0 && string(afterRaw) != "null" {
		_ = json.Unmarshal(afterRaw, &ev.After)
	}
	if len(metaRaw) > 0 && string(metaRaw) != "null" {
		_ = json.Unmarshal(metaRaw, &ev.Meta)
	}
	return ev, nil
}

const eventSelect = `SELECT id, ts, tenant_id, coalesce(user_id::text,''), service, action,
       coalesce(entity_type,''), coalesce(entity_id,''),
       coalesce(ip::text,''), result, before, after, meta
FROM audit_log`

// List returns paginated events for a tenant with optional filters.
func (s *Store) List(ctx context.Context, tid uuid.UUID, opts ListOpts) ([]domain.Event, int, error) {
	if opts.Limit <= 0 {
		opts.Limit = 50
	}
	if opts.Limit > 500 {
		opts.Limit = 500
	}

	var events []domain.Event
	var total int

	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		args := []any{}
		argN := 0
		addArg := func(v any) int {
			args = append(args, v)
			argN++
			return argN
		}

		var whereParts []string

		if opts.Service != "" {
			whereParts = append(whereParts, fmt.Sprintf("service = $%d", addArg(opts.Service)))
		}
		if opts.Action != "" {
			whereParts = append(whereParts, fmt.Sprintf("action = $%d", addArg(opts.Action)))
		}
		if opts.EntityType != "" {
			whereParts = append(whereParts, fmt.Sprintf("entity_type = $%d", addArg(opts.EntityType)))
		}
		if opts.EntityID != "" {
			whereParts = append(whereParts, fmt.Sprintf("entity_id = $%d", addArg(opts.EntityID)))
		}
		if opts.UserID != "" {
			whereParts = append(whereParts, fmt.Sprintf("user_id::text = $%d", addArg(opts.UserID)))
		}
		if opts.Result != "" {
			whereParts = append(whereParts, fmt.Sprintf("result = $%d", addArg(opts.Result)))
		}
		if opts.From != nil {
			whereParts = append(whereParts, fmt.Sprintf("ts >= $%d", addArg(*opts.From)))
		}
		if opts.To != nil {
			whereParts = append(whereParts, fmt.Sprintf("ts <= $%d", addArg(*opts.To)))
		}
		if opts.Q != "" {
			like := "%" + opts.Q + "%"
			a1, a2, a3 := addArg(like), addArg(like), addArg(like)
			whereParts = append(whereParts, fmt.Sprintf(
				"(action ILIKE $%d OR entity_id ILIKE $%d OR meta::text ILIKE $%d)", a1, a2, a3))
		}

		whereSQL := ""
		if len(whereParts) > 0 {
			whereSQL = "WHERE " + strings.Join(whereParts, " AND ")
		}

		if err := tx.QueryRow(ctx,
			fmt.Sprintf(`SELECT count(*) FROM audit_log %s`, whereSQL),
			args...).Scan(&total); err != nil {
			return err
		}

		limitIdx := addArg(opts.Limit)
		offsetIdx := addArg(opts.Offset)
		listQuery := fmt.Sprintf(`%s %s ORDER BY ts DESC LIMIT $%d OFFSET $%d`,
			eventSelect, whereSQL, limitIdx, offsetIdx)

		rows, err := tx.Query(ctx, listQuery, args...)
		if err != nil {
			return err
		}
		defer rows.Close()

		for rows.Next() {
			ev, err := scanEvent(rows)
			if err != nil {
				return err
			}
			events = append(events, ev)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, 0, err
	}
	if events == nil {
		events = []domain.Event{}
	}
	return events, total, nil
}

// GetByID returns a single audit event by ID for a tenant.
func (s *Store) GetByID(ctx context.Context, tid uuid.UUID, id string) (domain.Event, error) {
	var ev domain.Event
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		row := tx.QueryRow(ctx,
			fmt.Sprintf(`%s WHERE id = $1::uuid`, eventSelect), id)
		var err error
		ev, err = scanEvent(row)
		return err
	})
	return ev, err
}

// Buckets returns daily event counts per service for the past N days.
func (s *Store) Buckets(ctx context.Context, tid uuid.UUID, days int) ([]domain.Bucket, error) {
	if days <= 0 {
		days = 14
	}
	var buckets []domain.Bucket
	err := withTenant(ctx, s.p, tid, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, service, count(*) AS cnt
			FROM audit_log
			WHERE ts >= now() - ($1 || ' days')::interval
			GROUP BY day, service
			ORDER BY day, service`, fmt.Sprintf("%d", days))
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var b domain.Bucket
			if err := rows.Scan(&b.Day, &b.Service, &b.Count); err != nil {
				return err
			}
			buckets = append(buckets, b)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	if buckets == nil {
		buckets = []domain.Bucket{}
	}
	return buckets, nil
}
