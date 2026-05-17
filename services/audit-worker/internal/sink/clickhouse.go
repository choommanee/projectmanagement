package sink

import (
	"context"
	"encoding/json"

	"github.com/ClickHouse/clickhouse-go/v2"
	"github.com/ClickHouse/clickhouse-go/v2/lib/driver"

	"github.com/pmplatform/libs/go/audit"
)

type CH struct{ conn driver.Conn }

func NewCH(dsn string) (*CH, error) {
	opts, err := clickhouse.ParseDSN(dsn)
	if err != nil {
		return nil, err
	}
	conn, err := clickhouse.Open(opts)
	if err != nil {
		return nil, err
	}
	return &CH{conn: conn}, nil
}

func (s *CH) Insert(ctx context.Context, ev audit.Event) error {
	bef, _ := json.Marshal(ev.Before)
	aft, _ := json.Marshal(ev.After)
	meta, _ := json.Marshal(ev.Meta)
	return s.conn.Exec(ctx, `
      INSERT INTO audit.audit_log
        (ts, id, tenant_id, user_id, service, action, entity_type, entity_id, ip, result, before, after, meta)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		ev.Timestamp, ev.ID, ev.TenantID, ev.UserID, ev.Service, ev.Action,
		ev.EntityType, ev.EntityID, ev.IP, ev.Result, string(bef), string(aft), string(meta))
}
