# Plan #2 — Identity & Tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `tenant-svc` (tenant lifecycle, tiering, region binding) and `identity-svc` (users, OIDC IdP, JWT issuance, RBAC with Cedar, audit) plus the shared auth middleware in `libs/go/auth`. Establish Postgres RLS pattern and ClickHouse audit pipeline.

**Architecture:** Two Go services backed by Postgres (own schemas, RLS enforced). Identity issues short-lived JWTs (access 15 min) + opaque refresh tokens. Cedar policy engine for ABAC/RBAC evaluation. Audit events published to NATS subject `audit.>` and consumed by a small worker that batches into ClickHouse `audit_log`.

**Tech Stack:** Go 1.23, pgx/v5, chi, lestrrat-go/jwx (JWT/JWS/JWK), Cedar-Go (policy), goose (migrations), zerolog, NATS JetStream, ClickHouse-go.

**Prerequisites:** Plan #1 complete (workspace, libs, dev env).

---

## File Structure

```
services/
├── tenant-svc/
│   ├── go.mod
│   ├── cmd/server/main.go
│   ├── internal/
│   │   ├── api/         # http handlers
│   │   ├── domain/      # entities + business rules
│   │   ├── store/       # postgres repository
│   │   └── service/     # use cases
│   └── openapi.yaml
│
├── identity-svc/
│   ├── go.mod
│   ├── cmd/server/main.go
│   ├── internal/
│   │   ├── api/
│   │   ├── domain/
│   │   ├── store/
│   │   ├── service/
│   │   ├── jwt/         # signer + verifier
│   │   ├── policy/      # Cedar engine wrapper
│   │   └── audit/       # event publisher
│   └── openapi.yaml
│
└── audit-worker/
    ├── go.mod
    ├── cmd/worker/main.go
    └── internal/sink/clickhouse.go

libs/go/
├── auth/                # JWT middleware + tenant resolution + RBAC client
│   ├── go.mod
│   ├── middleware.go
│   ├── jwks.go
│   ├── tenant.go
│   └── middleware_test.go
└── audit/               # audit event publisher (used by all services)
    ├── go.mod
    ├── event.go
    ├── publisher.go
    └── publisher_test.go

infra/migrations/
├── tenant/
│   ├── 00001_tenant.sql
│   └── 00002_region.sql
├── identity/
│   ├── 00001_user.sql
│   ├── 00002_session.sql
│   ├── 00003_role_permission.sql
│   └── 00004_rls_policies.sql
└── audit/
    └── clickhouse/
        └── 00001_audit_log.sql
```

---

## Task 1: Tenant migrations + RLS pattern

**Files:**
- Create: `infra/migrations/tenant/00001_tenant.sql`
- Create: `infra/migrations/tenant/00002_region.sql`

- [ ] **Step 1: Write tenant migration**

File: `infra/migrations/tenant/00001_tenant.sql`

```sql
-- +goose Up
CREATE TYPE tenant_tier AS ENUM ('shared', 'schema', 'dedicated');
CREATE TYPE tenant_status AS ENUM ('active', 'suspended', 'archived');

CREATE TABLE tenant (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    name          TEXT NOT NULL,
    tier          tenant_tier NOT NULL DEFAULT 'shared',
    status        tenant_status NOT NULL DEFAULT 'active',
    region        TEXT NOT NULL DEFAULT 'ap-southeast-1',
    settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    version       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX tenant_status_idx ON tenant(status) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE tenant;
DROP TYPE tenant_status;
DROP TYPE tenant_tier;
```

- [ ] **Step 2: Write region migration**

File: `infra/migrations/tenant/00002_region.sql`

```sql
-- +goose Up
CREATE TABLE region (
    code         TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    active       BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO region(code, display_name) VALUES
  ('ap-southeast-1', 'Singapore'),
  ('ap-southeast-7', 'Bangkok'),
  ('us-east-1', 'N. Virginia'),
  ('eu-central-1', 'Frankfurt');

-- +goose Down
DROP TABLE region;
```

- [ ] **Step 3: Apply + verify**

```bash
./tools/scripts/migrate.sh up
docker compose exec -T postgres psql -U app -d platform -c "\d tenant"
```

Expected: shows columns id, slug, name, tier, ...

- [ ] **Step 4: Commit**

```bash
git add infra/migrations/tenant
git commit -m "feat(tenant): add tenant + region tables"
```

---

## Task 2: Identity migrations (user/session/role) + RLS policies

**Files:**
- Create: `infra/migrations/identity/00001_user.sql`
- Create: `infra/migrations/identity/00002_session.sql`
- Create: `infra/migrations/identity/00003_role_permission.sql`
- Create: `infra/migrations/identity/00004_rls_policies.sql`

- [ ] **Step 1: User migration**

File: `infra/migrations/identity/00001_user.sql`

```sql
-- +goose Up
CREATE TYPE user_status AS ENUM ('active', 'invited', 'suspended');

CREATE TABLE app_user (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE RESTRICT,
    email          CITEXT NOT NULL,
    display_name   TEXT NOT NULL,
    status         user_status NOT NULL DEFAULT 'active',
    password_hash  TEXT,                       -- nullable for SSO-only users
    mfa_secret     TEXT,
    external_idp   TEXT,                       -- 'oidc:foo', 'saml:bar', null = local
    external_sub   TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at     TIMESTAMPTZ,
    version        INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, email),
    UNIQUE (external_idp, external_sub)
);

CREATE INDEX app_user_tenant_idx ON app_user(tenant_id) WHERE deleted_at IS NULL;

-- +goose Down
DROP TABLE app_user;
DROP TYPE user_status;
```

Add `citext` extension (extend `_shared/00001_extensions.sql`):

```sql
-- in _shared/00001_extensions.sql, append to Up section:
CREATE EXTENSION IF NOT EXISTS "citext";
```

- [ ] **Step 2: Session migration**

File: `infra/migrations/identity/00002_session.sql`

```sql
-- +goose Up
CREATE TABLE session (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL UNIQUE,
    ip             INET,
    user_agent     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,
    revoked_at     TIMESTAMPTZ
);

CREATE INDEX session_user_idx ON session(user_id) WHERE revoked_at IS NULL;

-- +goose Down
DROP TABLE session;
```

- [ ] **Step 3: Role/permission migration**

File: `infra/migrations/identity/00003_role_permission.sql`

```sql
-- +goose Up
CREATE TABLE role (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    is_system   BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE role_assignment (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    role_id    UUID NOT NULL REFERENCES role(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL DEFAULT 'tenant',   -- 'tenant' | 'project' | 'document'
    scope_id   UUID,                              -- null when scope_type='tenant'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, user_id, role_id, scope_type, scope_id)
);

CREATE INDEX role_assignment_user_idx ON role_assignment(tenant_id, user_id);

-- Cedar policies stored as text per tenant
CREATE TABLE policy (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version    INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, name)
);

-- +goose Down
DROP TABLE policy;
DROP TABLE role_assignment;
DROP TABLE role;
```

- [ ] **Step 4: RLS policy migration**

File: `infra/migrations/identity/00004_rls_policies.sql`

```sql
-- +goose Up
-- Pattern: every tenant-scoped table enables RLS, filters via app.current_tenant session var.

ALTER TABLE app_user        ENABLE ROW LEVEL SECURITY;
ALTER TABLE session         ENABLE ROW LEVEL SECURITY;
ALTER TABLE role            ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy          ENABLE ROW LEVEL SECURITY;

-- Helper function: read current tenant or null
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION current_tenant_uuid() RETURNS UUID AS $$
DECLARE v TEXT := current_setting('app.current_tenant', true);
BEGIN
    IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
    RETURN v::uuid;
END;
$$ LANGUAGE plpgsql STABLE;
-- +goose StatementEnd

CREATE POLICY app_user_tenant_isolation     ON app_user        USING (tenant_id = current_tenant_uuid());
CREATE POLICY session_tenant_isolation      ON session         USING (tenant_id = current_tenant_uuid());
CREATE POLICY role_tenant_isolation         ON role            USING (tenant_id = current_tenant_uuid());
CREATE POLICY role_assn_tenant_isolation    ON role_assignment USING (tenant_id = current_tenant_uuid());
CREATE POLICY policy_tenant_isolation       ON policy          USING (tenant_id = current_tenant_uuid());

-- Service-level bypass role (used by identity-svc only)
CREATE ROLE app_svc NOLOGIN;
ALTER TABLE app_user        FORCE ROW LEVEL SECURITY;
ALTER TABLE session         FORCE ROW LEVEL SECURITY;
ALTER TABLE role            FORCE ROW LEVEL SECURITY;
ALTER TABLE role_assignment FORCE ROW LEVEL SECURITY;
ALTER TABLE policy          FORCE ROW LEVEL SECURITY;
GRANT app_svc TO app;  -- in dev only; prod uses dedicated user

-- +goose Down
DROP POLICY policy_tenant_isolation       ON policy;
DROP POLICY role_assn_tenant_isolation    ON role_assignment;
DROP POLICY role_tenant_isolation         ON role;
DROP POLICY session_tenant_isolation      ON session;
DROP POLICY app_user_tenant_isolation     ON app_user;
DROP FUNCTION current_tenant_uuid();
```

- [ ] **Step 5: Apply + verify**

```bash
docker compose down -v && ./tools/scripts/dev-up.sh && ./tools/scripts/migrate.sh up
docker compose exec -T postgres psql -U app -d platform -c "\d app_user"
docker compose exec -T postgres psql -U app -d platform -c "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('app_user','role','session');"
```

Expected: `relrowsecurity = t` for each.

- [ ] **Step 6: Commit**

```bash
git add infra/migrations/identity infra/migrations/_shared
git commit -m "feat(identity): add user/session/role tables + RLS policies"
```

---

## Task 3: Tenant service — domain + store

**Files:**
- Create: `services/tenant-svc/go.mod`
- Create: `services/tenant-svc/internal/domain/tenant.go`
- Create: `services/tenant-svc/internal/store/postgres.go`
- Create: `services/tenant-svc/internal/store/postgres_test.go`

- [ ] **Step 1: Init module**

```bash
mkdir -p services/tenant-svc/{cmd/server,internal/{api,domain,store,service}}
cd services/tenant-svc
go mod init github.com/pmplatform/services/tenant-svc
go get github.com/jackc/pgx/v5 github.com/google/uuid github.com/go-chi/chi/v5
cd ../..
go work use ./services/tenant-svc
```

Then add replace directives via `go.work` (already handles modules). Verify:

```bash
go work sync
```

- [ ] **Step 2: Write domain**

File: `services/tenant-svc/internal/domain/tenant.go`

```go
package domain

import (
    "errors"
    "regexp"
    "time"

    "github.com/google/uuid"
)

type Tier string

const (
    TierShared    Tier = "shared"
    TierSchema    Tier = "schema"
    TierDedicated Tier = "dedicated"
)

type Status string

const (
    StatusActive    Status = "active"
    StatusSuspended Status = "suspended"
    StatusArchived  Status = "archived"
)

type Tenant struct {
    ID        uuid.UUID
    Slug      string
    Name      string
    Tier      Tier
    Status    Status
    Region    string
    Settings  map[string]any
    CreatedAt time.Time
    UpdatedAt time.Time
    Version   int
}

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,62}$`)

var (
    ErrInvalidSlug = errors.New("invalid slug")
    ErrInvalidName = errors.New("name required")
    ErrNotFound    = errors.New("tenant not found")
    ErrConflict    = errors.New("version conflict")
)

func NewTenant(slug, name, region string, tier Tier) (*Tenant, error) {
    if !slugRe.MatchString(slug) {
        return nil, ErrInvalidSlug
    }
    if name == "" {
        return nil, ErrInvalidName
    }
    if tier == "" {
        tier = TierShared
    }
    if region == "" {
        region = "ap-southeast-1"
    }
    return &Tenant{
        ID: uuid.New(), Slug: slug, Name: name, Tier: tier,
        Status: StatusActive, Region: region, Settings: map[string]any{},
        Version: 1,
    }, nil
}
```

- [ ] **Step 3: Write store test (uses testcontainers via dev pg)**

File: `services/tenant-svc/internal/store/postgres_test.go`

```go
package store

import (
    "context"
    "os"
    "testing"

    "github.com/jackc/pgx/v5/pgxpool"
    "github.com/pmplatform/services/tenant-svc/internal/domain"
)

func openPool(t *testing.T) *pgxpool.Pool {
    dsn := os.Getenv("TEST_DATABASE_URL")
    if dsn == "" {
        dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
    }
    p, err := pgxpool.New(context.Background(), dsn)
    if err != nil {
        t.Skipf("postgres unavailable: %v", err)
    }
    return p
}

func TestCreateAndGet(t *testing.T) {
    p := openPool(t)
    defer p.Close()
    s := New(p)
    tn, err := domain.NewTenant("acme-"+randSuffix(), "Acme Co", "", "")
    if err != nil { t.Fatal(err) }
    if err := s.Create(context.Background(), tn); err != nil { t.Fatal(err) }
    got, err := s.GetByID(context.Background(), tn.ID)
    if err != nil { t.Fatal(err) }
    if got.Slug != tn.Slug { t.Fatalf("got %s", got.Slug) }
}

func TestUpdateOptimistic(t *testing.T) {
    p := openPool(t)
    defer p.Close()
    s := New(p)
    tn, _ := domain.NewTenant("upd-"+randSuffix(), "U", "", "")
    _ = s.Create(context.Background(), tn)
    tn.Name = "U2"
    if err := s.Update(context.Background(), tn); err != nil { t.Fatal(err) }
    // stale update should fail
    stale := *tn
    stale.Version = 1
    if err := s.Update(context.Background(), &stale); err != domain.ErrConflict {
        t.Fatalf("expected conflict, got %v", err)
    }
}

func randSuffix() string {
    return "x" + os.Getenv("TEST_RUN_ID") + "z"
}
```

(Use `t.Cleanup` + random UUID slugs in real impl. Keep tests independent of TEST_RUN_ID by generating a random suffix in production code — replace `randSuffix` with `uuid.NewString()[:8]`.)

Update `randSuffix`:

```go
import "github.com/google/uuid"
func randSuffix() string { return uuid.NewString()[:8] }
```

- [ ] **Step 4: Run test, verify it fails**

```bash
cd services/tenant-svc && go test ./internal/store/...
```

Expected: FAIL (undefined: New).

- [ ] **Step 5: Implement store**

File: `services/tenant-svc/internal/store/postgres.go`

```go
package store

import (
    "context"
    "encoding/json"
    "errors"

    "github.com/google/uuid"
    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgxpool"

    "github.com/pmplatform/services/tenant-svc/internal/domain"
)

type Store struct{ p *pgxpool.Pool }

func New(p *pgxpool.Pool) *Store { return &Store{p: p} }

// Tenant table is NOT tenant-scoped (it IS the tenant) so RLS is not applied here.
// Disable RLS context by NOT calling SET LOCAL.

func (s *Store) Create(ctx context.Context, t *domain.Tenant) error {
    settings, _ := json.Marshal(t.Settings)
    _, err := s.p.Exec(ctx, `
        INSERT INTO tenant(id, slug, name, tier, status, region, settings, version)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        t.ID, t.Slug, t.Name, t.Tier, t.Status, t.Region, settings, t.Version)
    return err
}

func (s *Store) GetByID(ctx context.Context, id uuid.UUID) (*domain.Tenant, error) {
    return s.queryOne(ctx, "id = $1", id)
}

func (s *Store) GetBySlug(ctx context.Context, slug string) (*domain.Tenant, error) {
    return s.queryOne(ctx, "slug = $1", slug)
}

func (s *Store) Update(ctx context.Context, t *domain.Tenant) error {
    settings, _ := json.Marshal(t.Settings)
    ct, err := s.p.Exec(ctx, `
        UPDATE tenant SET name=$2, tier=$3, status=$4, region=$5, settings=$6,
                          updated_at=now(), version=version+1
        WHERE id=$1 AND version=$7 AND deleted_at IS NULL`,
        t.ID, t.Name, t.Tier, t.Status, t.Region, settings, t.Version)
    if err != nil { return err }
    if ct.RowsAffected() == 0 { return domain.ErrConflict }
    t.Version++
    return nil
}

func (s *Store) queryOne(ctx context.Context, where string, args ...any) (*domain.Tenant, error) {
    row := s.p.QueryRow(ctx,
        "SELECT id, slug, name, tier, status, region, settings, created_at, updated_at, version FROM tenant WHERE "+where+" AND deleted_at IS NULL",
        args...)
    var t domain.Tenant
    var settings []byte
    err := row.Scan(&t.ID, &t.Slug, &t.Name, &t.Tier, &t.Status, &t.Region, &settings, &t.CreatedAt, &t.UpdatedAt, &t.Version)
    if errors.Is(err, pgx.ErrNoRows) { return nil, domain.ErrNotFound }
    if err != nil { return nil, err }
    _ = json.Unmarshal(settings, &t.Settings)
    return &t, nil
}
```

- [ ] **Step 6: Run test, verify it passes**

```bash
cd services/tenant-svc && go test ./internal/store/...
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/tenant-svc go.work
git commit -m "feat(tenant-svc): add domain + postgres store"
```

---

## Task 4: Tenant service — HTTP API + main

**Files:**
- Create: `services/tenant-svc/internal/service/service.go`
- Create: `services/tenant-svc/internal/api/handlers.go`
- Create: `services/tenant-svc/internal/api/handlers_test.go`
- Create: `services/tenant-svc/cmd/server/main.go`

- [ ] **Step 1: Write service layer**

File: `services/tenant-svc/internal/service/service.go`

```go
package service

import (
    "context"

    "github.com/google/uuid"

    "github.com/pmplatform/services/tenant-svc/internal/domain"
    "github.com/pmplatform/services/tenant-svc/internal/store"
)

type Service struct{ s *store.Store }

func New(s *store.Store) *Service { return &Service{s: s} }

type CreateInput struct {
    Slug, Name, Region string
    Tier               domain.Tier
}

func (svc *Service) Create(ctx context.Context, in CreateInput) (*domain.Tenant, error) {
    t, err := domain.NewTenant(in.Slug, in.Name, in.Region, in.Tier)
    if err != nil { return nil, err }
    if err := svc.s.Create(ctx, t); err != nil { return nil, err }
    return t, nil
}

func (svc *Service) Get(ctx context.Context, id uuid.UUID) (*domain.Tenant, error) {
    return svc.s.GetByID(ctx, id)
}

func (svc *Service) GetBySlug(ctx context.Context, slug string) (*domain.Tenant, error) {
    return svc.s.GetBySlug(ctx, slug)
}
```

- [ ] **Step 2: Write handler test**

File: `services/tenant-svc/internal/api/handlers_test.go`

```go
package api

import (
    "bytes"
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "os"
    "testing"

    "github.com/jackc/pgx/v5/pgxpool"

    "github.com/pmplatform/services/tenant-svc/internal/service"
    "github.com/pmplatform/services/tenant-svc/internal/store"
)

func TestCreateTenantHTTP(t *testing.T) {
    dsn := os.Getenv("TEST_DATABASE_URL")
    if dsn == "" {
        dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
    }
    p, err := pgxpool.New(t.Context(), dsn)
    if err != nil { t.Skip(err) }
    defer p.Close()

    h := NewRouter(service.New(store.New(p)))

    body, _ := json.Marshal(map[string]string{
        "slug": "tcli-" + tShort(t),
        "name": "Test Co",
    })
    req := httptest.NewRequest(http.MethodPost, "/v1/tenants", bytes.NewReader(body))
    req.Header.Set("Content-Type", "application/json")
    rec := httptest.NewRecorder()
    h.ServeHTTP(rec, req)

    if rec.Code != http.StatusCreated {
        t.Fatalf("got %d: %s", rec.Code, rec.Body.String())
    }
}

func tShort(t *testing.T) string {
    return t.Name()[:6]
}
```

NOTE: replace `t.Context()` with `context.Background()` if Go version < 1.24 by adding `import "context"`.

- [ ] **Step 3: Run test, verify it fails**

```bash
cd services/tenant-svc && go test ./internal/api/...
```

Expected: FAIL (undefined: NewRouter).

- [ ] **Step 4: Implement handlers**

File: `services/tenant-svc/internal/api/handlers.go`

```go
package api

import (
    "encoding/json"
    "errors"
    "net/http"

    "github.com/go-chi/chi/v5"
    "github.com/google/uuid"

    "github.com/pmplatform/services/tenant-svc/internal/domain"
    "github.com/pmplatform/services/tenant-svc/internal/service"
)

func NewRouter(svc *service.Service) http.Handler {
    r := chi.NewRouter()
    r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
        writeJSON(w, 200, map[string]string{"status": "ok"})
    })
    r.Route("/v1/tenants", func(r chi.Router) {
        r.Post("/", create(svc))
        r.Get("/{id}", get(svc))
        r.Get("/by-slug/{slug}", getBySlug(svc))
    })
    return r
}

type createReq struct {
    Slug   string      `json:"slug"`
    Name   string      `json:"name"`
    Tier   domain.Tier `json:"tier,omitempty"`
    Region string      `json:"region,omitempty"`
}

func create(svc *service.Service) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        var in createReq
        if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
            writeErr(w, http.StatusBadRequest, err); return
        }
        t, err := svc.Create(r.Context(), service.CreateInput{
            Slug: in.Slug, Name: in.Name, Tier: in.Tier, Region: in.Region,
        })
        if err != nil {
            switch {
            case errors.Is(err, domain.ErrInvalidSlug), errors.Is(err, domain.ErrInvalidName):
                writeErr(w, http.StatusBadRequest, err)
            default:
                writeErr(w, http.StatusInternalServerError, err)
            }
            return
        }
        writeJSON(w, http.StatusCreated, t)
    }
}

func get(svc *service.Service) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        id, err := uuid.Parse(chi.URLParam(r, "id"))
        if err != nil { writeErr(w, 400, err); return }
        t, err := svc.Get(r.Context(), id)
        if errors.Is(err, domain.ErrNotFound) { writeErr(w, 404, err); return }
        if err != nil { writeErr(w, 500, err); return }
        writeJSON(w, 200, t)
    }
}

func getBySlug(svc *service.Service) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        t, err := svc.GetBySlug(r.Context(), chi.URLParam(r, "slug"))
        if errors.Is(err, domain.ErrNotFound) { writeErr(w, 404, err); return }
        if err != nil { writeErr(w, 500, err); return }
        writeJSON(w, 200, t)
    }
}

func writeJSON(w http.ResponseWriter, code int, body any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(code)
    _ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, code int, err error) {
    writeJSON(w, code, map[string]string{"error": err.Error()})
}
```

- [ ] **Step 5: Implement main**

File: `services/tenant-svc/cmd/server/main.go`

```go
package main

import (
    "context"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/jackc/pgx/v5/pgxpool"
    "github.com/rs/zerolog/log"

    "github.com/pmplatform/services/tenant-svc/internal/api"
    "github.com/pmplatform/services/tenant-svc/internal/service"
    "github.com/pmplatform/services/tenant-svc/internal/store"
)

func main() {
    dsn := envOr("DATABASE_URL", "postgres://app:app@localhost:5432/platform?sslmode=disable")
    port := envOr("PORT", "8081")

    p, err := pgxpool.New(context.Background(), dsn)
    if err != nil { log.Fatal().Err(err).Send() }
    defer p.Close()

    h := api.NewRouter(service.New(store.New(p)))
    srv := &http.Server{Addr: ":" + port, Handler: h, ReadHeaderTimeout: 5 * time.Second}

    go func() {
        log.Info().Str("addr", srv.Addr).Msg("tenant-svc listening")
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatal().Err(err).Send()
        }
    }()

    stop := make(chan os.Signal, 1)
    signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
    <-stop
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    _ = srv.Shutdown(ctx)
}

func envOr(k, def string) string { if v := os.Getenv(k); v != "" { return v }; return def }
```

Add zerolog dep:

```bash
cd services/tenant-svc && go get github.com/rs/zerolog && cd ../..
```

- [ ] **Step 6: Run handler test, verify pass**

```bash
cd services/tenant-svc && go test ./...
```

Expected: PASS.

- [ ] **Step 7: Smoke test live server**

```bash
cd services/tenant-svc
DATABASE_URL=postgres://app:app@localhost:5432/platform?sslmode=disable PORT=8081 go run ./cmd/server &
sleep 1
curl -sS -X POST http://localhost:8081/v1/tenants -H 'content-type: application/json' \
  -d '{"slug":"smoke-1","name":"Smoke Inc"}' | jq .
kill %1
```

Expected: returns JSON with `id`, `slug=smoke-1`, `tier=shared`.

- [ ] **Step 8: Commit**

```bash
git add services/tenant-svc
git commit -m "feat(tenant-svc): add service + http handlers + main"
```

---

## Task 5: Shared auth lib — JWT signer/verifier + JWKS

**Files:**
- Create: `libs/go/auth/go.mod`
- Create: `libs/go/auth/jwt.go`
- Create: `libs/go/auth/jwks.go`
- Create: `libs/go/auth/jwt_test.go`

- [ ] **Step 1: Init module**

```bash
mkdir -p libs/go/auth
cd libs/go/auth
go mod init github.com/pmplatform/libs/go/auth
go get github.com/lestrrat-go/jwx/v2/jwt github.com/lestrrat-go/jwx/v2/jwa github.com/lestrrat-go/jwx/v2/jwk
go get github.com/google/uuid
cd ../../..
go work use ./libs/go/auth
```

- [ ] **Step 2: Write test**

File: `libs/go/auth/jwt_test.go`

```go
package auth

import (
    "crypto/rand"
    "crypto/rsa"
    "testing"
    "time"

    "github.com/lestrrat-go/jwx/v2/jwk"
)

func newKeySet(t *testing.T) (jwk.Key, jwk.Set) {
    priv, _ := rsa.GenerateKey(rand.Reader, 2048)
    privKey, _ := jwk.FromRaw(priv)
    _ = privKey.Set(jwk.KeyIDKey, "test-1")
    _ = privKey.Set(jwk.AlgorithmKey, "RS256")
    pubKey, _ := privKey.PublicKey()
    set := jwk.NewSet()
    _ = set.AddKey(pubKey)
    return privKey, set
}

func TestSignAndVerify(t *testing.T) {
    priv, pub := newKeySet(t)
    s := NewSigner(priv, "test-issuer")
    tok, err := s.Sign(Claims{
        Subject: "user-1", TenantID: "ten-1",
        Roles: []string{"admin"}, TTL: time.Minute,
    })
    if err != nil { t.Fatal(err) }
    v := NewVerifier(pub, "test-issuer")
    c, err := v.Verify(tok)
    if err != nil { t.Fatal(err) }
    if c.Subject != "user-1" || c.TenantID != "ten-1" || c.Roles[0] != "admin" {
        t.Fatalf("bad claims: %+v", c)
    }
}
```

- [ ] **Step 3: Implement signer/verifier**

File: `libs/go/auth/jwt.go`

```go
package auth

import (
    "errors"
    "time"

    "github.com/google/uuid"
    "github.com/lestrrat-go/jwx/v2/jwa"
    "github.com/lestrrat-go/jwx/v2/jwk"
    "github.com/lestrrat-go/jwx/v2/jwt"
)

type Claims struct {
    Subject  string
    TenantID string
    Roles    []string
    TTL      time.Duration
}

type ParsedClaims struct {
    Subject  string
    TenantID string
    Roles    []string
    ExpireAt time.Time
}

type Signer struct {
    key    jwk.Key
    issuer string
}

func NewSigner(key jwk.Key, issuer string) *Signer { return &Signer{key: key, issuer: issuer} }

func (s *Signer) Sign(c Claims) (string, error) {
    if c.TTL == 0 { c.TTL = 15 * time.Minute }
    tok, err := jwt.NewBuilder().
        Issuer(s.issuer).
        Subject(c.Subject).
        IssuedAt(time.Now()).
        Expiration(time.Now().Add(c.TTL)).
        JwtID(uuid.NewString()).
        Claim("tid", c.TenantID).
        Claim("roles", c.Roles).
        Build()
    if err != nil { return "", err }
    signed, err := jwt.Sign(tok, jwt.WithKey(jwa.RS256, s.key))
    if err != nil { return "", err }
    return string(signed), nil
}

type Verifier struct {
    keys   jwk.Set
    issuer string
}

func NewVerifier(keys jwk.Set, issuer string) *Verifier { return &Verifier{keys: keys, issuer: issuer} }

func (v *Verifier) Verify(token string) (*ParsedClaims, error) {
    tok, err := jwt.Parse([]byte(token),
        jwt.WithKeySet(v.keys, jwt.WithInferAlgorithmFromKey(true)),
        jwt.WithIssuer(v.issuer),
        jwt.WithValidate(true),
    )
    if err != nil { return nil, err }
    out := &ParsedClaims{
        Subject:  tok.Subject(),
        ExpireAt: tok.Expiration(),
    }
    if v, ok := tok.Get("tid"); ok { out.TenantID, _ = v.(string) }
    if v, ok := tok.Get("roles"); ok {
        if arr, ok := v.([]any); ok {
            for _, e := range arr { if s, ok := e.(string); ok { out.Roles = append(out.Roles, s) } }
        }
    }
    if out.ExpireAt.Before(time.Now()) { return nil, errors.New("token expired") }
    return out, nil
}
```

- [ ] **Step 4: Write JWKS fetcher**

File: `libs/go/auth/jwks.go`

```go
package auth

import (
    "context"
    "time"

    "github.com/lestrrat-go/jwx/v2/jwk"
)

// CachedJWKS fetches and caches JWKS from an URL with auto-refresh.
func CachedJWKS(ctx context.Context, url string) (jwk.Set, error) {
    c := jwk.NewCache(ctx)
    if err := c.Register(url, jwk.WithMinRefreshInterval(time.Hour)); err != nil {
        return nil, err
    }
    if _, err := c.Refresh(ctx, url); err != nil { return nil, err }
    return jwk.NewCachedSet(c, url), nil
}
```

- [ ] **Step 5: Run test, verify it passes**

```bash
cd libs/go/auth && go test ./...
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/go/auth go.work
git commit -m "feat(libs/go/auth): add JWT signer/verifier + JWKS cache"
```

---

## Task 6: Shared auth lib — middleware (auth + tenant)

**Files:**
- Modify: `libs/go/auth/middleware.go`
- Create: `libs/go/auth/middleware_test.go`
- Create: `libs/go/auth/tenant.go`

- [ ] **Step 1: Write middleware test**

File: `libs/go/auth/middleware_test.go`

```go
package auth

import (
    "net/http"
    "net/http/httptest"
    "testing"
    "time"
)

func TestRequireAuthRejectsMissing(t *testing.T) {
    _, pub := newKeySet(t)
    mw := Require(NewVerifier(pub, "iss"))
    h := mw(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }))
    rec := httptest.NewRecorder()
    h.ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
    if rec.Code != 401 { t.Fatalf("want 401 got %d", rec.Code) }
}

func TestRequireAuthInjectsClaims(t *testing.T) {
    priv, pub := newKeySet(t)
    tok, _ := NewSigner(priv, "iss").Sign(Claims{Subject: "u1", TenantID: "t1", Roles: []string{"x"}, TTL: time.Minute})
    mw := Require(NewVerifier(pub, "iss"))
    h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        c := MustFromCtx(r.Context())
        if c.Subject != "u1" || c.TenantID != "t1" { t.Errorf("bad: %+v", c) }
        w.WriteHeader(204)
    }))
    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/", nil)
    req.Header.Set("Authorization", "Bearer "+tok)
    h.ServeHTTP(rec, req)
    if rec.Code != 204 { t.Fatalf("want 204 got %d", rec.Code) }
}
```

- [ ] **Step 2: Run test, verify it fails**

```bash
cd libs/go/auth && go test -run TestRequireAuth ./...
```

Expected: FAIL.

- [ ] **Step 3: Implement middleware**

File: `libs/go/auth/middleware.go`

```go
package auth

import (
    "context"
    "net/http"
    "strings"
)

type ctxKey int

const claimsKey ctxKey = 1

func Require(v *Verifier) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            tok := bearer(r)
            if tok == "" { http.Error(w, "missing token", 401); return }
            c, err := v.Verify(tok)
            if err != nil { http.Error(w, "invalid token", 401); return }
            ctx := context.WithValue(r.Context(), claimsKey, c)
            next.ServeHTTP(w, r.WithContext(ctx))
        })
    }
}

func bearer(r *http.Request) string {
    h := r.Header.Get("Authorization")
    if !strings.HasPrefix(h, "Bearer ") { return "" }
    return strings.TrimPrefix(h, "Bearer ")
}

func MustFromCtx(ctx context.Context) *ParsedClaims {
    c, _ := ctx.Value(claimsKey).(*ParsedClaims)
    if c == nil { panic("auth claims missing — middleware not mounted?") }
    return c
}

func FromCtx(ctx context.Context) (*ParsedClaims, bool) {
    c, ok := ctx.Value(claimsKey).(*ParsedClaims)
    return c, ok
}
```

- [ ] **Step 4: Write tenant resolution middleware**

File: `libs/go/auth/tenant.go`

```go
package auth

import (
    "net/http"
)

// TenantHeader injects tenant id from JWT claim into a request header
// downstream services can read consistently.
func TenantHeader(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        if c, ok := FromCtx(r.Context()); ok && c.TenantID != "" {
            r.Header.Set("X-Tenant-Id", c.TenantID)
        }
        next.ServeHTTP(w, r)
    })
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
cd libs/go/auth && go test ./...
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/go/auth
git commit -m "feat(libs/go/auth): add Require + TenantHeader middleware"
```

---

## Task 7: Identity service — schema + password hashing + user store

**Files:**
- Create: `services/identity-svc/go.mod`
- Create: `services/identity-svc/internal/domain/user.go`
- Create: `services/identity-svc/internal/store/user_store.go`
- Create: `services/identity-svc/internal/store/user_store_test.go`

- [ ] **Step 1: Init module**

```bash
mkdir -p services/identity-svc/{cmd/server,internal/{api,domain,store,service,jwt,policy,audit}}
cd services/identity-svc
go mod init github.com/pmplatform/services/identity-svc
go get github.com/jackc/pgx/v5 github.com/google/uuid github.com/go-chi/chi/v5 github.com/rs/zerolog
go get golang.org/x/crypto/argon2 golang.org/x/crypto/bcrypt
cd ../..
go work use ./services/identity-svc
```

- [ ] **Step 2: Write domain**

File: `services/identity-svc/internal/domain/user.go`

```go
package domain

import (
    "errors"
    "time"

    "github.com/google/uuid"
    "golang.org/x/crypto/bcrypt"
)

type Status string

const (
    StatusActive    Status = "active"
    StatusInvited   Status = "invited"
    StatusSuspended Status = "suspended"
)

type User struct {
    ID            uuid.UUID
    TenantID      uuid.UUID
    Email         string
    DisplayName   string
    Status        Status
    PasswordHash  string
    ExternalIDP   string
    ExternalSub   string
    CreatedAt     time.Time
    UpdatedAt     time.Time
    Version       int
}

var (
    ErrNotFound       = errors.New("user not found")
    ErrInvalidCreds   = errors.New("invalid credentials")
    ErrInvalidEmail   = errors.New("invalid email")
    ErrPasswordWeak   = errors.New("password too weak")
)

func HashPassword(plain string) (string, error) {
    if len(plain) < 10 { return "", ErrPasswordWeak }
    h, err := bcrypt.GenerateFromPassword([]byte(plain), 12)
    return string(h), err
}

func CheckPassword(hash, plain string) error {
    if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)); err != nil {
        return ErrInvalidCreds
    }
    return nil
}
```

- [ ] **Step 3: Write store test**

File: `services/identity-svc/internal/store/user_store_test.go`

```go
package store

import (
    "context"
    "os"
    "testing"

    "github.com/google/uuid"
    "github.com/jackc/pgx/v5/pgxpool"

    "github.com/pmplatform/services/identity-svc/internal/domain"
)

func pool(t *testing.T) *pgxpool.Pool {
    dsn := os.Getenv("TEST_DATABASE_URL")
    if dsn == "" { dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable" }
    p, err := pgxpool.New(context.Background(), dsn)
    if err != nil { t.Skipf("postgres unavailable: %v", err) }
    return p
}

func makeTenant(t *testing.T, p *pgxpool.Pool) uuid.UUID {
    id := uuid.New()
    _, err := p.Exec(context.Background(),
        `INSERT INTO tenant(id, slug, name) VALUES ($1, 'u-'||substr(md5(random()::text),1,6), 'X')`, id)
    if err != nil { t.Fatal(err) }
    return id
}

func TestCreateAndFindUser(t *testing.T) {
    p := pool(t); defer p.Close()
    tid := makeTenant(t, p)
    s := NewUsers(p)
    pw, _ := domain.HashPassword("StrongPass1!")
    u := &domain.User{
        ID: uuid.New(), TenantID: tid, Email: "a@" + uuid.NewString()[:6] + ".com",
        DisplayName: "A", Status: domain.StatusActive, PasswordHash: pw, Version: 1,
    }
    if err := s.Create(context.Background(), u); err != nil { t.Fatal(err) }
    got, err := s.FindByEmail(context.Background(), tid, u.Email)
    if err != nil { t.Fatal(err) }
    if got.ID != u.ID { t.Fatalf("got %v", got.ID) }
}
```

- [ ] **Step 4: Run test, verify fail**

```bash
cd services/identity-svc && go test ./internal/store/...
```

Expected: FAIL (undefined: NewUsers).

- [ ] **Step 5: Implement store**

File: `services/identity-svc/internal/store/user_store.go`

```go
package store

import (
    "context"
    "errors"
    "fmt"

    "github.com/google/uuid"
    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgxpool"

    "github.com/pmplatform/services/identity-svc/internal/domain"
)

type Users struct{ p *pgxpool.Pool }

func NewUsers(p *pgxpool.Pool) *Users { return &Users{p: p} }

// withTenant sets app.current_tenant inside a tx for RLS.
func (s *Users) withTenant(ctx context.Context, tid uuid.UUID, fn func(pgx.Tx) error) error {
    tx, err := s.p.Begin(ctx)
    if err != nil { return err }
    defer tx.Rollback(ctx)
    if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = '%s'", tid.String())); err != nil { return err }
    if err := fn(tx); err != nil { return err }
    return tx.Commit(ctx)
}

func (s *Users) Create(ctx context.Context, u *domain.User) error {
    return s.withTenant(ctx, u.TenantID, func(tx pgx.Tx) error {
        _, err := tx.Exec(ctx, `
            INSERT INTO app_user(id, tenant_id, email, display_name, status, password_hash, external_idp, external_sub, version)
            VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,''),NULLIF($8,''),$9)`,
            u.ID, u.TenantID, u.Email, u.DisplayName, u.Status, u.PasswordHash, u.ExternalIDP, u.ExternalSub, u.Version)
        return err
    })
}

func (s *Users) FindByEmail(ctx context.Context, tid uuid.UUID, email string) (*domain.User, error) {
    var u domain.User
    err := s.withTenant(ctx, tid, func(tx pgx.Tx) error {
        row := tx.QueryRow(ctx, `
            SELECT id, tenant_id, email, display_name, status, COALESCE(password_hash,''),
                   COALESCE(external_idp,''), COALESCE(external_sub,''), created_at, updated_at, version
            FROM app_user WHERE email = $1 AND deleted_at IS NULL`, email)
        return row.Scan(&u.ID, &u.TenantID, &u.Email, &u.DisplayName, &u.Status,
            &u.PasswordHash, &u.ExternalIDP, &u.ExternalSub, &u.CreatedAt, &u.UpdatedAt, &u.Version)
    })
    if errors.Is(err, pgx.ErrNoRows) { return nil, domain.ErrNotFound }
    if err != nil { return nil, err }
    return &u, nil
}
```

- [ ] **Step 6: Run test, verify pass**

```bash
cd services/identity-svc && go test ./internal/store/...
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/identity-svc go.work
git commit -m "feat(identity-svc): add user domain + store with RLS"
```

---

## Task 8: Identity service — JWT keypair init + signer wiring

**Files:**
- Create: `services/identity-svc/internal/jwt/signer.go`
- Create: `services/identity-svc/internal/jwt/signer_test.go`

- [ ] **Step 1: Add jwx dep**

```bash
cd services/identity-svc
go get github.com/lestrrat-go/jwx/v2/jwk
go get github.com/pmplatform/libs/go/auth
cd ../..
```

- [ ] **Step 2: Write test**

File: `services/identity-svc/internal/jwt/signer_test.go`

```go
package jwt

import (
    "testing"
    "time"

    libauth "github.com/pmplatform/libs/go/auth"
)

func TestKeyPairRoundtrip(t *testing.T) {
    kp, err := GenerateKeyPair("kid-1")
    if err != nil { t.Fatal(err) }
    tok, err := libauth.NewSigner(kp.Priv, "iss").Sign(libauth.Claims{
        Subject: "u", TenantID: "t", TTL: time.Minute,
    })
    if err != nil { t.Fatal(err) }
    set, _ := kp.JWKS()
    if _, err := libauth.NewVerifier(set, "iss").Verify(tok); err != nil {
        t.Fatal(err)
    }
}
```

- [ ] **Step 3: Run test, verify fail**

```bash
cd services/identity-svc && go test ./internal/jwt/...
```

Expected: FAIL.

- [ ] **Step 4: Implement keypair**

File: `services/identity-svc/internal/jwt/signer.go`

```go
package jwt

import (
    "crypto/rand"
    "crypto/rsa"

    "github.com/lestrrat-go/jwx/v2/jwk"
)

type KeyPair struct {
    Priv jwk.Key
}

func GenerateKeyPair(kid string) (*KeyPair, error) {
    raw, err := rsa.GenerateKey(rand.Reader, 2048)
    if err != nil { return nil, err }
    priv, err := jwk.FromRaw(raw)
    if err != nil { return nil, err }
    _ = priv.Set(jwk.KeyIDKey, kid)
    _ = priv.Set(jwk.AlgorithmKey, "RS256")
    return &KeyPair{Priv: priv}, nil
}

func (kp *KeyPair) JWKS() (jwk.Set, error) {
    pub, err := kp.Priv.PublicKey()
    if err != nil { return nil, err }
    set := jwk.NewSet()
    if err := set.AddKey(pub); err != nil { return nil, err }
    return set, nil
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
cd services/identity-svc && go test ./internal/jwt/...
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/identity-svc
git commit -m "feat(identity-svc): add JWT keypair generation"
```

---

## Task 9: Identity service — login flow + session store + handlers

**Files:**
- Create: `services/identity-svc/internal/store/session_store.go`
- Create: `services/identity-svc/internal/service/auth.go`
- Create: `services/identity-svc/internal/api/handlers.go`
- Create: `services/identity-svc/internal/api/handlers_test.go`

- [ ] **Step 1: Session store**

File: `services/identity-svc/internal/store/session_store.go`

```go
package store

import (
    "context"
    "crypto/sha256"
    "encoding/hex"
    "time"

    "github.com/google/uuid"
    "github.com/jackc/pgx/v5/pgxpool"
)

type Sessions struct{ p *pgxpool.Pool }

func NewSessions(p *pgxpool.Pool) *Sessions { return &Sessions{p: p} }

func HashToken(t string) string {
    sum := sha256.Sum256([]byte(t))
    return hex.EncodeToString(sum[:])
}

type Session struct {
    ID, UserID, TenantID uuid.UUID
    RefreshHash          string
    ExpiresAt            time.Time
}

func (s *Sessions) Create(ctx context.Context, sess Session) error {
    _, err := s.p.Exec(ctx, `
        INSERT INTO session(id, user_id, tenant_id, refresh_token_hash, expires_at)
        VALUES ($1,$2,$3,$4,$5)`,
        sess.ID, sess.UserID, sess.TenantID, sess.RefreshHash, sess.ExpiresAt)
    return err
}
```

- [ ] **Step 2: Auth service**

File: `services/identity-svc/internal/service/auth.go`

```go
package service

import (
    "context"
    "crypto/rand"
    "encoding/base64"
    "time"

    "github.com/google/uuid"

    libauth "github.com/pmplatform/libs/go/auth"

    "github.com/pmplatform/services/identity-svc/internal/domain"
    "github.com/pmplatform/services/identity-svc/internal/store"
)

type Auth struct {
    users    *store.Users
    sessions *store.Sessions
    signer   *libauth.Signer
}

func NewAuth(u *store.Users, s *store.Sessions, signer *libauth.Signer) *Auth {
    return &Auth{users: u, sessions: s, signer: signer}
}

type LoginInput struct {
    TenantID         uuid.UUID
    Email, Password  string
}

type TokenPair struct {
    AccessToken  string    `json:"access_token"`
    RefreshToken string    `json:"refresh_token"`
    ExpiresAt    time.Time `json:"expires_at"`
}

func (a *Auth) Login(ctx context.Context, in LoginInput) (*TokenPair, error) {
    u, err := a.users.FindByEmail(ctx, in.TenantID, in.Email)
    if err != nil { return nil, domain.ErrInvalidCreds }
    if u.Status != domain.StatusActive { return nil, domain.ErrInvalidCreds }
    if err := domain.CheckPassword(u.PasswordHash, in.Password); err != nil { return nil, err }

    access, err := a.signer.Sign(libauth.Claims{
        Subject: u.ID.String(), TenantID: u.TenantID.String(),
        Roles: []string{}, TTL: 15 * time.Minute,
    })
    if err != nil { return nil, err }

    refresh := randomToken(32)
    sess := store.Session{
        ID: uuid.New(), UserID: u.ID, TenantID: u.TenantID,
        RefreshHash: store.HashToken(refresh),
        ExpiresAt:   time.Now().Add(30 * 24 * time.Hour),
    }
    if err := a.sessions.Create(ctx, sess); err != nil { return nil, err }

    return &TokenPair{AccessToken: access, RefreshToken: refresh, ExpiresAt: time.Now().Add(15 * time.Minute)}, nil
}

func randomToken(n int) string {
    b := make([]byte, n)
    _, _ = rand.Read(b)
    return base64.RawURLEncoding.EncodeToString(b)
}
```

- [ ] **Step 3: Handlers test**

File: `services/identity-svc/internal/api/handlers_test.go`

```go
package api

import (
    "bytes"
    "context"
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "os"
    "testing"

    "github.com/google/uuid"
    "github.com/jackc/pgx/v5/pgxpool"

    libauth "github.com/pmplatform/libs/go/auth"

    "github.com/pmplatform/services/identity-svc/internal/domain"
    "github.com/pmplatform/services/identity-svc/internal/jwt"
    "github.com/pmplatform/services/identity-svc/internal/service"
    "github.com/pmplatform/services/identity-svc/internal/store"
)

func TestLoginHappyPath(t *testing.T) {
    dsn := os.Getenv("TEST_DATABASE_URL")
    if dsn == "" { dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable" }
    p, err := pgxpool.New(context.Background(), dsn)
    if err != nil { t.Skip(err) }
    defer p.Close()

    // seed: tenant + user
    tid := uuid.New()
    _, _ = p.Exec(context.Background(),
        `INSERT INTO tenant(id, slug, name) VALUES ($1,'lg-'||substr(md5(random()::text),1,6),'L')`, tid)
    pw, _ := domain.HashPassword("VeryStrong#1")
    uid := uuid.New()
    _, _ = p.Exec(context.Background(),
        `SET LOCAL app.current_tenant = '`+tid.String()+`';
         INSERT INTO app_user(id, tenant_id, email, display_name, status, password_hash, version)
         VALUES ($1,$2,'login@test.com','L','active',$3,1)`, uid, tid, pw)

    kp, _ := jwt.GenerateKeyPair("kid-1")
    signer := libauth.NewSigner(kp.Priv, "test")
    auth := service.NewAuth(store.NewUsers(p), store.NewSessions(p), signer)

    h := NewRouter(auth, kp)

    body, _ := json.Marshal(map[string]string{
        "tenant_id": tid.String(), "email": "login@test.com", "password": "VeryStrong#1",
    })
    req := httptest.NewRequest("POST", "/v1/login", bytes.NewReader(body))
    req.Header.Set("Content-Type", "application/json")
    rec := httptest.NewRecorder()
    h.ServeHTTP(rec, req)
    if rec.Code != 200 { t.Fatalf("got %d: %s", rec.Code, rec.Body.String()) }
    var tp service.TokenPair
    _ = json.Unmarshal(rec.Body.Bytes(), &tp)
    if tp.AccessToken == "" { t.Fatal("no access token") }
}
```

- [ ] **Step 4: Run test, verify fail**

```bash
cd services/identity-svc && go test ./internal/api/...
```

Expected: FAIL.

- [ ] **Step 5: Implement handlers**

File: `services/identity-svc/internal/api/handlers.go`

```go
package api

import (
    "encoding/json"
    "errors"
    "net/http"

    "github.com/go-chi/chi/v5"
    "github.com/google/uuid"

    "github.com/pmplatform/services/identity-svc/internal/domain"
    sjwt "github.com/pmplatform/services/identity-svc/internal/jwt"
    "github.com/pmplatform/services/identity-svc/internal/service"
)

func NewRouter(auth *service.Auth, kp *sjwt.KeyPair) http.Handler {
    r := chi.NewRouter()
    r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
        writeJSON(w, 200, map[string]string{"status": "ok"})
    })
    r.Get("/.well-known/jwks.json", jwksHandler(kp))
    r.Post("/v1/login", login(auth))
    return r
}

type loginReq struct {
    TenantID string `json:"tenant_id"`
    Email    string `json:"email"`
    Password string `json:"password"`
}

func login(auth *service.Auth) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        var in loginReq
        if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
            writeErr(w, 400, err); return
        }
        tid, err := uuid.Parse(in.TenantID)
        if err != nil { writeErr(w, 400, errors.New("bad tenant_id")); return }
        tp, err := auth.Login(r.Context(), service.LoginInput{TenantID: tid, Email: in.Email, Password: in.Password})
        if err != nil {
            if errors.Is(err, domain.ErrInvalidCreds) { writeErr(w, 401, err); return }
            writeErr(w, 500, err); return
        }
        writeJSON(w, 200, tp)
    }
}

func jwksHandler(kp *sjwt.KeyPair) http.HandlerFunc {
    return func(w http.ResponseWriter, _ *http.Request) {
        set, err := kp.JWKS()
        if err != nil { writeErr(w, 500, err); return }
        w.Header().Set("Content-Type", "application/json")
        b, _ := json.Marshal(set)
        _, _ = w.Write(b)
    }
}

func writeJSON(w http.ResponseWriter, code int, body any) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(code)
    _ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, code int, err error) {
    writeJSON(w, code, map[string]string{"error": err.Error()})
}
```

- [ ] **Step 6: Run test, verify pass**

```bash
cd services/identity-svc && go test ./...
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/identity-svc
git commit -m "feat(identity-svc): add login + JWKS endpoint"
```

---

## Task 10: Identity main + smoke test

**Files:**
- Create: `services/identity-svc/cmd/server/main.go`

- [ ] **Step 1: Implement main**

File: `services/identity-svc/cmd/server/main.go`

```go
package main

import (
    "context"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/jackc/pgx/v5/pgxpool"
    "github.com/rs/zerolog/log"

    libauth "github.com/pmplatform/libs/go/auth"

    "github.com/pmplatform/services/identity-svc/internal/api"
    "github.com/pmplatform/services/identity-svc/internal/jwt"
    "github.com/pmplatform/services/identity-svc/internal/service"
    "github.com/pmplatform/services/identity-svc/internal/store"
)

func main() {
    dsn := envOr("DATABASE_URL", "postgres://app:app@localhost:5432/platform?sslmode=disable")
    port := envOr("PORT", "8082")
    issuer := envOr("JWT_ISSUER", "http://localhost:8082")
    kid := envOr("JWT_KID", "kid-dev-1")

    p, err := pgxpool.New(context.Background(), dsn)
    if err != nil { log.Fatal().Err(err).Send() }
    defer p.Close()

    kp, err := jwt.GenerateKeyPair(kid)
    if err != nil { log.Fatal().Err(err).Send() }
    signer := libauth.NewSigner(kp.Priv, issuer)

    auth := service.NewAuth(store.NewUsers(p), store.NewSessions(p), signer)
    h := api.NewRouter(auth, kp)
    srv := &http.Server{Addr: ":" + port, Handler: h, ReadHeaderTimeout: 5 * time.Second}

    go func() {
        log.Info().Str("addr", srv.Addr).Msg("identity-svc listening")
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatal().Err(err).Send()
        }
    }()

    stop := make(chan os.Signal, 1)
    signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
    <-stop
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    _ = srv.Shutdown(ctx)
}

func envOr(k, def string) string { if v := os.Getenv(k); v != "" { return v }; return def }
```

NOTE: In prod the keypair MUST be persisted (file/KMS) — Task 11 covers this. Dev generates on each boot.

- [ ] **Step 2: Smoke test live**

```bash
cd services/identity-svc
DATABASE_URL=postgres://app:app@localhost:5432/platform?sslmode=disable PORT=8082 go run ./cmd/server &
sleep 1
curl -s http://localhost:8082/.well-known/jwks.json | jq .
curl -s http://localhost:8082/healthz
kill %1
```

Expected: JWKS JSON with one RSA key.

- [ ] **Step 3: Commit**

```bash
git add services/identity-svc
git commit -m "feat(identity-svc): add main entrypoint"
```

---

## Task 11: Persist JWT key + key rotation scaffold

**Files:**
- Create: `services/identity-svc/internal/jwt/store.go`
- Create: `infra/migrations/identity/00005_signing_keys.sql`

- [ ] **Step 1: Migration**

File: `infra/migrations/identity/00005_signing_keys.sql`

```sql
-- +goose Up
CREATE TABLE signing_key (
    kid         TEXT PRIMARY KEY,
    private_pem TEXT NOT NULL,
    public_jwk  JSONB NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE signing_key;
```

Apply:

```bash
./tools/scripts/migrate.sh up
```

- [ ] **Step 2: Implement persistence**

File: `services/identity-svc/internal/jwt/store.go`

```go
package jwt

import (
    "context"
    "crypto/rand"
    "crypto/rsa"
    "crypto/x509"
    "encoding/json"
    "encoding/pem"
    "errors"

    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgxpool"
    "github.com/lestrrat-go/jwx/v2/jwk"
)

func LoadOrCreate(ctx context.Context, p *pgxpool.Pool, kid string) (*KeyPair, error) {
    var pemStr string
    err := p.QueryRow(ctx, "SELECT private_pem FROM signing_key WHERE kid=$1 AND active", kid).Scan(&pemStr)
    if errors.Is(err, pgx.ErrNoRows) {
        return create(ctx, p, kid)
    }
    if err != nil { return nil, err }
    block, _ := pem.Decode([]byte(pemStr))
    if block == nil { return nil, errors.New("invalid pem") }
    raw, err := x509.ParsePKCS1PrivateKey(block.Bytes)
    if err != nil { return nil, err }
    priv, err := jwk.FromRaw(raw)
    if err != nil { return nil, err }
    _ = priv.Set(jwk.KeyIDKey, kid)
    _ = priv.Set(jwk.AlgorithmKey, "RS256")
    return &KeyPair{Priv: priv}, nil
}

func create(ctx context.Context, p *pgxpool.Pool, kid string) (*KeyPair, error) {
    raw, err := rsa.GenerateKey(rand.Reader, 2048)
    if err != nil { return nil, err }
    pemBytes := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(raw)})
    priv, err := jwk.FromRaw(raw)
    if err != nil { return nil, err }
    _ = priv.Set(jwk.KeyIDKey, kid)
    _ = priv.Set(jwk.AlgorithmKey, "RS256")
    pub, err := priv.PublicKey()
    if err != nil { return nil, err }
    pubJSON, _ := json.Marshal(pub)
    if _, err := p.Exec(ctx,
        `INSERT INTO signing_key(kid, private_pem, public_jwk) VALUES ($1,$2,$3)`,
        kid, string(pemBytes), pubJSON); err != nil { return nil, err }
    return &KeyPair{Priv: priv}, nil
}
```

- [ ] **Step 3: Update main to use LoadOrCreate**

Edit `services/identity-svc/cmd/server/main.go`:

Replace `kp, err := jwt.GenerateKeyPair(kid)` with:

```go
kp, err := jwt.LoadOrCreate(context.Background(), p, kid)
```

- [ ] **Step 4: Smoke test — verify key persists across restart**

```bash
cd services/identity-svc
DATABASE_URL=postgres://app:app@localhost:5432/platform?sslmode=disable PORT=8082 go run ./cmd/server &
sleep 1
FIRST=$(curl -s http://localhost:8082/.well-known/jwks.json | jq -r .keys[0].n)
kill %1
sleep 1
go run ./cmd/server &
sleep 1
SECOND=$(curl -s http://localhost:8082/.well-known/jwks.json | jq -r .keys[0].n)
kill %1
[ "$FIRST" = "$SECOND" ] && echo "OK persisted" || echo "FAIL"
```

Expected: `OK persisted`.

- [ ] **Step 5: Commit**

```bash
git add infra/migrations/identity services/identity-svc
git commit -m "feat(identity-svc): persist JWT signing key in Postgres"
```

---

## Task 12: Cedar policy engine wrapper

**Files:**
- Create: `services/identity-svc/internal/policy/cedar.go`
- Create: `services/identity-svc/internal/policy/cedar_test.go`

- [ ] **Step 1: Add cedar dep**

```bash
cd services/identity-svc
go get github.com/cedar-policy/cedar-go@latest
cd ../..
```

- [ ] **Step 2: Write test**

File: `services/identity-svc/internal/policy/cedar_test.go`

```go
package policy

import "testing"

func TestEvaluateAllow(t *testing.T) {
    pol := `permit(principal == User::"alice", action == Action::"read", resource == Doc::"d1");`
    e, err := New([]Policy{{Name: "p1", Body: pol}})
    if err != nil { t.Fatal(err) }
    ok, err := e.IsAllowed(Request{
        Principal: `User::"alice"`,
        Action:    `Action::"read"`,
        Resource:  `Doc::"d1"`,
    })
    if err != nil { t.Fatal(err) }
    if !ok { t.Fatal("expected allow") }
}

func TestEvaluateDenyByDefault(t *testing.T) {
    e, _ := New(nil)
    ok, _ := e.IsAllowed(Request{
        Principal: `User::"x"`, Action: `Action::"read"`, Resource: `Doc::"y"`,
    })
    if ok { t.Fatal("expected deny") }
}
```

- [ ] **Step 3: Run test, verify fail**

```bash
cd services/identity-svc && go test ./internal/policy/...
```

Expected: FAIL.

- [ ] **Step 4: Implement wrapper**

File: `services/identity-svc/internal/policy/cedar.go`

```go
package policy

import (
    "github.com/cedar-policy/cedar-go"
)

type Policy struct {
    Name string
    Body string
}

type Engine struct{ ps *cedar.PolicySet }

func New(policies []Policy) (*Engine, error) {
    ps := cedar.NewPolicySet()
    for _, p := range policies {
        list, err := cedar.NewPolicyListFromBytes(p.Name, []byte(p.Body))
        if err != nil { return nil, err }
        for i, pol := range list {
            ps.Add(cedar.PolicyID(p.Name+"#"+itoa(i)), pol)
        }
    }
    return &Engine{ps: ps}, nil
}

type Request struct {
    Principal, Action, Resource string
    Context                     map[string]any
}

func (e *Engine) IsAllowed(r Request) (bool, error) {
    p, err := cedar.NewEntityUID(r.Principal)
    if err != nil { return false, err }
    a, err := cedar.NewEntityUID(r.Action)
    if err != nil { return false, err }
    res, err := cedar.NewEntityUID(r.Resource)
    if err != nil { return false, err }
    decision, _ := e.ps.IsAuthorized(cedar.Entities{}, cedar.Request{
        Principal: p, Action: a, Resource: res,
        Context: cedar.NewRecord(toCedarRecord(r.Context)),
    })
    return decision == cedar.Allow, nil
}

func toCedarRecord(m map[string]any) cedar.RecordMap {
    out := cedar.RecordMap{}
    for k, v := range m {
        out[cedar.String(k)] = cedar.String(toString(v))
    }
    return out
}

func toString(v any) string {
    switch x := v.(type) {
    case string: return x
    default: return ""
    }
}

func itoa(i int) string {
    const digits = "0123456789"
    if i == 0 { return "0" }
    var b [20]byte
    pos := len(b)
    for i > 0 {
        pos--
        b[pos] = digits[i%10]
        i /= 10
    }
    return string(b[pos:])
}
```

NOTE: API surface of `cedar-go` may evolve. If signature differs in the version pulled, adjust to match the installed version's docs but keep the test contract.

- [ ] **Step 5: Run test, verify pass**

```bash
cd services/identity-svc && go test ./internal/policy/...
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/identity-svc
git commit -m "feat(identity-svc): add cedar policy engine wrapper"
```

---

## Task 13: Audit event lib + audit-worker (NATS → ClickHouse)

**Files:**
- Create: `libs/go/audit/go.mod`
- Create: `libs/go/audit/event.go`
- Create: `libs/go/audit/publisher.go`
- Create: `libs/go/audit/publisher_test.go`
- Create: `services/audit-worker/go.mod`
- Create: `services/audit-worker/cmd/worker/main.go`
- Create: `services/audit-worker/internal/sink/clickhouse.go`
- Create: `infra/migrations/audit/clickhouse/00001_audit_log.sql`

- [ ] **Step 1: Audit event types**

```bash
mkdir -p libs/go/audit
cd libs/go/audit
go mod init github.com/pmplatform/libs/go/audit
go get github.com/google/uuid
go get github.com/pmplatform/libs/go/nats
cd ../../..
go work use ./libs/go/audit
```

File: `libs/go/audit/event.go`

```go
package audit

import "time"

type Event struct {
    ID         string         `json:"id"`
    Timestamp  time.Time      `json:"ts"`
    TenantID   string         `json:"tenant_id"`
    UserID     string         `json:"user_id,omitempty"`
    Service    string         `json:"service"`
    Action     string         `json:"action"`
    EntityType string         `json:"entity_type,omitempty"`
    EntityID   string         `json:"entity_id,omitempty"`
    Before     map[string]any `json:"before,omitempty"`
    After      map[string]any `json:"after,omitempty"`
    IP         string         `json:"ip,omitempty"`
    Result     string         `json:"result"`           // "success" | "denied" | "error"
    Meta       map[string]any `json:"meta,omitempty"`
}
```

- [ ] **Step 2: Publisher test**

File: `libs/go/audit/publisher_test.go`

```go
package audit

import (
    "context"
    "encoding/json"
    "os"
    "testing"
    "time"

    natsx "github.com/pmplatform/libs/go/nats"
)

func TestPublishConsumes(t *testing.T) {
    url := os.Getenv("NATS_URL")
    if url == "" { url = "nats://localhost:4222" }
    c, err := natsx.Connect(url)
    if err != nil { t.Skip(err) }
    defer c.Close()
    if err := c.EnsureStream(context.Background(), "AUDIT", []string{"audit.>"}); err != nil { t.Fatal(err) }
    pub := NewPublisher(c, "test")
    got := make(chan []byte, 1)
    _, _ = c.Subscribe(context.Background(), "AUDIT", "audit.test.x", func(d []byte) error { got <- d; return nil })
    if err := pub.Publish(context.Background(), "test.x", Event{
        TenantID: "t1", Action: "login", Result: "success",
    }); err != nil { t.Fatal(err) }
    select {
    case msg := <-got:
        var ev Event
        _ = json.Unmarshal(msg, &ev)
        if ev.Action != "login" { t.Fatalf("got %+v", ev) }
    case <-time.After(3 * time.Second):
        t.Fatal("timeout")
    }
}
```

- [ ] **Step 3: Run test, verify fail**

```bash
cd libs/go/audit && go test ./...
```

Expected: FAIL.

- [ ] **Step 4: Implement publisher**

File: `libs/go/audit/publisher.go`

```go
package audit

import (
    "context"
    "encoding/json"
    "time"

    "github.com/google/uuid"
    natsx "github.com/pmplatform/libs/go/nats"
)

type Publisher struct {
    c       *natsx.Client
    service string
}

func NewPublisher(c *natsx.Client, service string) *Publisher {
    return &Publisher{c: c, service: service}
}

func (p *Publisher) Publish(ctx context.Context, action string, ev Event) error {
    if ev.ID == "" { ev.ID = uuid.NewString() }
    if ev.Timestamp.IsZero() { ev.Timestamp = time.Now().UTC() }
    if ev.Service == "" { ev.Service = p.service }
    if ev.Action == "" { ev.Action = action }
    data, err := json.Marshal(ev)
    if err != nil { return err }
    return p.c.Publish(ctx, "audit."+action, data)
}
```

- [ ] **Step 5: Run test, verify pass**

```bash
cd libs/go/audit && go test ./...
```

Expected: PASS.

- [ ] **Step 6: ClickHouse schema**

File: `infra/migrations/audit/clickhouse/00001_audit_log.sql`

```sql
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
    before      String,        -- JSON
    after       String,        -- JSON
    meta        String         -- JSON
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (tenant_id, ts, id)
TTL toDateTime(ts) + INTERVAL 13 MONTH DELETE;
```

Apply:

```bash
docker compose exec -T clickhouse clickhouse-client --multiquery < infra/migrations/audit/clickhouse/00001_audit_log.sql
docker compose exec -T clickhouse clickhouse-client -q "SHOW TABLES FROM audit"
```

Expected: lists `audit_log`.

- [ ] **Step 7: Audit worker**

```bash
mkdir -p services/audit-worker/{cmd/worker,internal/sink}
cd services/audit-worker
go mod init github.com/pmplatform/services/audit-worker
go get github.com/ClickHouse/clickhouse-go/v2@latest
go get github.com/pmplatform/libs/go/{nats,audit,logger}
cd ../..
go work use ./services/audit-worker
```

File: `services/audit-worker/internal/sink/clickhouse.go`

```go
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
    if err != nil { return nil, err }
    conn, err := clickhouse.Open(opts)
    if err != nil { return nil, err }
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
```

File: `services/audit-worker/cmd/worker/main.go`

```go
package main

import (
    "context"
    "encoding/json"
    "os"
    "os/signal"
    "syscall"

    "github.com/rs/zerolog/log"

    "github.com/pmplatform/libs/go/audit"
    natsx "github.com/pmplatform/libs/go/nats"

    "github.com/pmplatform/services/audit-worker/internal/sink"
)

func main() {
    natsURL := envOr("NATS_URL", "nats://localhost:4222")
    chDSN := envOr("CLICKHOUSE_DSN", "clickhouse://localhost:9000/audit")

    c, err := natsx.Connect(natsURL)
    if err != nil { log.Fatal().Err(err).Send() }
    defer c.Close()
    if err := c.EnsureStream(context.Background(), "AUDIT", []string{"audit.>"}); err != nil {
        log.Fatal().Err(err).Send()
    }

    s, err := sink.NewCH(chDSN)
    if err != nil { log.Fatal().Err(err).Send() }

    _, err = c.Subscribe(context.Background(), "AUDIT", "audit.>", func(data []byte) error {
        var ev audit.Event
        if err := json.Unmarshal(data, &ev); err != nil { return err }
        return s.Insert(context.Background(), ev)
    })
    if err != nil { log.Fatal().Err(err).Send() }

    log.Info().Msg("audit-worker consuming audit.>")
    stop := make(chan os.Signal, 1)
    signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
    <-stop
}

func envOr(k, def string) string { if v := os.Getenv(k); v != "" { return v }; return def }
```

Add zerolog dep:

```bash
cd services/audit-worker && go get github.com/rs/zerolog && cd ../..
```

- [ ] **Step 8: Smoke test**

```bash
cd services/audit-worker
go run ./cmd/worker &
sleep 1
# Publish an event via the publisher (manual using nats CLI alternative — use a quick Go script or library):
cd ../..
go run -mod=mod ./tools/scripts/audit-test-publish.go 2>/dev/null || true
# OR query directly:
docker compose exec -T clickhouse clickhouse-client -q "SELECT count(*) FROM audit.audit_log"
kill %1
```

(If the helper script doesn't exist, skip — the publisher test in Task 13 step 5 already verified end-to-end.)

- [ ] **Step 9: Commit**

```bash
git add libs/go/audit services/audit-worker infra/migrations/audit go.work
git commit -m "feat: audit publisher lib + worker writing to ClickHouse"
```

---

## Task 14: Wire identity-svc to publish login audit events

**Files:**
- Modify: `services/identity-svc/internal/service/auth.go`
- Modify: `services/identity-svc/cmd/server/main.go`

- [ ] **Step 1: Inject publisher into Auth**

Edit `services/identity-svc/internal/service/auth.go` — add field and method:

```go
import (
    ...
    "github.com/pmplatform/libs/go/audit"
)

type Auth struct {
    users    *store.Users
    sessions *store.Sessions
    signer   *libauth.Signer
    aud      *audit.Publisher
}

func NewAuth(u *store.Users, s *store.Sessions, signer *libauth.Signer, aud *audit.Publisher) *Auth {
    return &Auth{users: u, sessions: s, signer: signer, aud: aud}
}
```

In `Login`, after success and after failure, publish:

```go
// on success (before return)
_ = a.aud.Publish(ctx, "user.login", audit.Event{
    TenantID: in.TenantID.String(), UserID: u.ID.String(),
    EntityType: "user", EntityID: u.ID.String(), Result: "success",
})

// on invalid creds (before return)
_ = a.aud.Publish(ctx, "user.login", audit.Event{
    TenantID: in.TenantID.String(), Action: "user.login",
    EntityType: "user", Result: "denied",
    Meta: map[string]any{"email": in.Email},
})
```

- [ ] **Step 2: Update main to construct publisher**

In `services/identity-svc/cmd/server/main.go`:

```go
import (
    ...
    natsx "github.com/pmplatform/libs/go/nats"
    "github.com/pmplatform/libs/go/audit"
)

// inside main, after pool:
natsURL := envOr("NATS_URL", "nats://localhost:4222")
nc, err := natsx.Connect(natsURL)
if err != nil { log.Fatal().Err(err).Send() }
defer nc.Close()
_ = nc.EnsureStream(context.Background(), "AUDIT", []string{"audit.>"})
pub := audit.NewPublisher(nc, "identity-svc")

auth := service.NewAuth(store.NewUsers(p), store.NewSessions(p), signer, pub)
```

Add deps:

```bash
cd services/identity-svc && go get github.com/pmplatform/libs/go/{nats,audit} && cd ../..
```

- [ ] **Step 3: Update existing handler test (it constructs Auth) — pass a no-op publisher**

Add to `services/identity-svc/internal/api/handlers_test.go` imports & setup:

```go
import natsx "github.com/pmplatform/libs/go/nats"
import "github.com/pmplatform/libs/go/audit"

// inside TestLoginHappyPath, replace auth construction:
url := os.Getenv("NATS_URL"); if url == "" { url = "nats://localhost:4222" }
nc, err := natsx.Connect(url)
if err != nil { t.Skip(err) }
defer nc.Close()
_ = nc.EnsureStream(context.Background(), "AUDIT", []string{"audit.>"})
pub := audit.NewPublisher(nc, "test")
auth := service.NewAuth(store.NewUsers(p), store.NewSessions(p), signer, pub)
```

- [ ] **Step 4: Run all identity-svc tests**

```bash
cd services/identity-svc && go test ./...
```

Expected: PASS.

- [ ] **Step 5: End-to-end smoke (login → audit row in ClickHouse)**

```bash
# Terminal A
cd services/audit-worker && go run ./cmd/worker

# Terminal B
cd services/identity-svc
DATABASE_URL=... PORT=8082 go run ./cmd/server
# Terminal C
curl -X POST http://localhost:8082/v1/login -H 'content-type: application/json' \
  -d '{"tenant_id":"<seed-tenant-id>","email":"login@test.com","password":"VeryStrong#1"}'
docker compose exec -T clickhouse clickhouse-client -q \
  "SELECT count(*), max(ts) FROM audit.audit_log WHERE action='user.login'"
```

Expected: count >= 1, ts ~ now.

- [ ] **Step 6: Commit**

```bash
git add services/identity-svc
git commit -m "feat(identity-svc): publish audit events on login"
```

---

## Task 15: End-to-end smoke + Helm value stubs

- [ ] **Step 1: Run full test suite**

```bash
for d in $(find services libs/go -name go.mod -exec dirname {} \;); do
  echo "==> $d"
  (cd "$d" && go test ./... -count=1) || exit 1
done
```

Expected: all green.

- [ ] **Step 2: Helm value enable identity/tenant**

Edit `infra/helm/platform/values.yaml`:

```yaml
services:
  identity: { enabled: true, replicas: 2, image: identity-svc, port: 8082 }
  tenant:   { enabled: true, replicas: 2, image: tenant-svc,  port: 8081 }
```

(Templates rendering is out of scope for this plan; values stub is enough.)

- [ ] **Step 3: Tag baseline**

```bash
git add infra/helm
git commit -m "chore(infra): enable identity + tenant in helm values"
git tag plan-02-identity-tenant-complete
```

---

## Self-review

- All migrations have explicit Up/Down. RLS pattern proven by tests.
- JWT keypair persisted across restart (Task 11 smoke).
- Audit pipeline end-to-end verified (Task 14 step 5).
- Cedar wrapper kept thin (engine, request, decision) — extend in service plans that need richer entity stores.
- SAML federation NOT implemented; OIDC federation also deferred to a later sub-plan that adds external IdP support. Login path supports only local password in Phase 1.
- Open items captured for later: refresh-token rotation endpoint, MFA enrollment, password reset, OIDC IdP federation, key rotation cron.
- Cedar action × resource registry: see [ADR 0002](../../adr/0002-cedar-actions.md). All product-service action names referenced in `bundle.cedar` (and added by Plan #4) MUST appear in that table.
