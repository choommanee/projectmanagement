CREATE DATABASE IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.audit_log (
    ts          DateTime64(3, 'UTC'),
    id          UUID,
    tenant_id   String,
    user_id     String,
    service     LowCardinality(String),
    action      LowCardinality(String),
    entity_type LowCardinality(String),
    entity_id   String,
    ip          String,
    result      LowCardinality(String),
    before      String,
    after       String,
    meta        String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (tenant_id, ts, id)
TTL toDateTime(ts) + INTERVAL 13 MONTH DELETE;
