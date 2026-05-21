package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PgPublisher writes audit events directly to Postgres (no NATS).
type PgPublisher struct {
	p       *pgxpool.Pool
	service string
}

// NewPgPublisher creates a publisher that writes directly to the audit_log table.
func NewPgPublisher(p *pgxpool.Pool, service string) *PgPublisher {
	return &PgPublisher{p: p, service: service}
}

// Publish writes one event to the audit_log table using SET LOCAL tenant isolation.
func (pp *PgPublisher) Publish(ctx context.Context, action string, ev Event) error {
	if ev.ID == "" {
		ev.ID = uuid.NewString()
	}
	if ev.Timestamp.IsZero() {
		ev.Timestamp = time.Now().UTC()
	}
	if ev.Service == "" {
		ev.Service = pp.service
	}
	if ev.Action == "" {
		ev.Action = action
	}
	if ev.Result == "" {
		ev.Result = "success"
	}
	if ev.TenantID == "" {
		return fmt.Errorf("audit event missing tenant_id")
	}

	before, _ := json.Marshal(ev.Before)
	after, _ := json.Marshal(ev.After)
	meta, _ := json.Marshal(ev.Meta)

	tx, err := pp.p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", ev.TenantID)); err != nil {
		return err
	}

	var ip any
	if ev.IP != "" {
		ip = ev.IP
	}
	var userID any
	if ev.UserID != "" {
		userID = ev.UserID
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO audit_log(id, tenant_id, ts, user_id, service, action, entity_type, entity_id, ip, result, before, after, meta)
		VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, NULLIF($7,''), NULLIF($8,''), $9::inet, $10, $11::jsonb, $12::jsonb, $13::jsonb)`,
		ev.ID, ev.TenantID, ev.Timestamp, userID, ev.Service, ev.Action,
		ev.EntityType, ev.EntityID, ip, ev.Result,
		string(before), string(after), string(meta),
	)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
