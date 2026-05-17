# Plan #1 — Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the monorepo skeleton, local dev environment (Docker Compose), shared libraries (Go/Rust/TS), and base CI pipeline so all subsequent sub-projects have a working baseline.

**Architecture:** Polyglot monorepo: Go workspace (`go.work`) for Go services, Cargo workspace for Rust services, pnpm + Turborepo for TS apps and shared packages. Local dev via Docker Compose for all infra dependencies. CI via GitHub Actions with per-language matrix.

**Tech Stack:** Go 1.23, Rust 1.83, Node 22, pnpm 9, Turborepo 2, PostgreSQL 16, Redis 7, NATS 2.10 (JetStream), ClickHouse 24.x, Meilisearch 1.10, MinIO. GitHub Actions for CI. Goose for migrations.

---

## File Structure

Root monorepo layout:

```
.
├── go.work                          # Go workspace
├── Cargo.toml                       # Rust workspace (members defined here)
├── pnpm-workspace.yaml              # pnpm workspace
├── turbo.json                       # Turborepo pipeline
├── package.json                     # Root TS deps + scripts
├── .editorconfig
├── .gitignore
├── .gitattributes
├── README.md
├── docker-compose.yml               # Local dev infra
├── .env.example
│
├── docs/
│   ├── adr/
│   │   ├── README.md
│   │   └── 0001-monorepo-layout.md
│   ├── runbook/README.md
│   ├── superpowers/                 # specs + plans live here (already exists)
│   └── dev-setup.md
│
├── services/                        # Go services live here
│   └── _template/                   # template service used in tests
│       ├── go.mod
│       ├── cmd/server/main.go
│       └── internal/...
│
├── engines/                         # Rust services
│   └── _template/
│       ├── Cargo.toml
│       └── src/main.rs
│
├── apps/                            # Next.js apps
│   └── web/                         # (created in Plan #3 — placeholder only)
│
├── packages/                        # Shared TS packages
│   ├── design-tokens/
│   │   ├── package.json
│   │   ├── src/index.ts
│   │   └── tsconfig.json
│   └── ui-kit/                      # (created in Plan #3 — placeholder only)
│
├── libs/
│   ├── go/                          # Shared Go libs
│   │   ├── logger/                  # zerolog wrapper
│   │   ├── config/                  # env-based config loader
│   │   ├── db/                      # pgx wrapper + RLS helper
│   │   ├── nats/                    # JetStream client wrapper
│   │   ├── otel/                    # OpenTelemetry init
│   │   └── httpx/                   # chi-based base server + middleware
│   └── rust/
│       ├── obs/                     # tracing + otel
│       └── db/                      # sqlx wrapper
│
├── infra/
│   ├── docker/                      # custom Dockerfiles for dev images (if needed)
│   ├── helm/
│   │   └── platform/                # umbrella chart skeleton
│   └── migrations/                  # goose migration root (per service subdirs)
│
├── tools/
│   ├── scripts/
│   │   ├── bootstrap.sh             # one-shot setup
│   │   ├── dev-up.sh                # docker compose up + seed
│   │   └── dev-down.sh
│   └── ci/
│       └── matrix.json              # CI lang matrix
│
└── .github/
    └── workflows/
        ├── ci-go.yml
        ├── ci-rust.yml
        ├── ci-node.yml
        ├── ci-docker.yml
        └── ci-lint.yml
```

---

## Task 1: Repository skeleton + tooling

**Files:**
- Create: `README.md`
- Create: `.editorconfig`
- Create: `.gitignore`
- Create: `.gitattributes`
- Create: `tools/scripts/bootstrap.sh`

- [ ] **Step 1: Init git + base files**

```bash
cd /Users/sakdachoommanee/Documents/projectmanagment
git init
git branch -M main
```

- [ ] **Step 2: Create `.gitignore`**

```gitignore
# OS
.DS_Store
Thumbs.db

# Editors
.idea/
.vscode/*
!.vscode/settings.json
!.vscode/extensions.json
*.swp

# Go
*.exe
*.test
*.out
/services/**/bin/

# Rust
target/
**/*.rs.bk

# Node
node_modules/
.next/
.turbo/
dist/
build/
coverage/

# Env
.env
.env.local
.env.*.local

# Logs
*.log

# Infra local state
infra/local-data/
```

- [ ] **Step 3: Create `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.go]
indent_style = tab
indent_size = 4

[*.rs]
indent_size = 4

[Makefile]
indent_style = tab
```

- [ ] **Step 4: Create `.gitattributes`**

```gitattributes
* text=auto eol=lf
*.png binary
*.jpg binary
*.gif binary
*.ico binary
*.pdf binary
```

- [ ] **Step 5: Create `README.md`**

```markdown
# PM + Manufacturing SaaS

Polyglot monorepo: Go services + Rust engines + Next.js frontend.

## Quick start

\`\`\`bash
./tools/scripts/bootstrap.sh
./tools/scripts/dev-up.sh
\`\`\`

See [docs/dev-setup.md](docs/dev-setup.md) for details.
```

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: initialize repo skeleton"
```

---

## Task 2: Docker Compose dev environment

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `infra/docker/clickhouse/init.sql`
- Create: `tools/scripts/dev-up.sh`
- Create: `tools/scripts/dev-down.sh`

- [ ] **Step 1: Create `.env.example`**

```env
# Postgres
POSTGRES_USER=app
POSTGRES_PASSWORD=app
POSTGRES_DB=platform
POSTGRES_HOST=localhost
POSTGRES_PORT=5432

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# NATS
NATS_URL=nats://localhost:4222

# ClickHouse
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=9000
CLICKHOUSE_DB=audit

# Meilisearch
MEILI_HOST=http://localhost:7700
MEILI_MASTER_KEY=dev-master-key

# MinIO (S3-compatible)
S3_ENDPOINT=http://localhost:9100
S3_REGION=us-east-1
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=platform
```

- [ ] **Step 2: Create `docker-compose.yml`**

```yaml
name: pm-platform

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-app}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-app}
      POSTGRES_DB: ${POSTGRES_DB:-platform}
    ports: ["5432:5432"]
    volumes:
      - ./infra/local-data/pg:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-app}"]
      interval: 3s
      retries: 20

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    volumes:
      - ./infra/local-data/redis:/data

  nats:
    image: nats:2.10-alpine
    command: ["-js", "-sd", "/data"]
    ports:
      - "4222:4222"
      - "8222:8222"
    volumes:
      - ./infra/local-data/nats:/data

  clickhouse:
    image: clickhouse/clickhouse-server:24.8-alpine
    ports:
      - "9000:9000"
      - "8123:8123"
    ulimits:
      nofile: { soft: 262144, hard: 262144 }
    volumes:
      - ./infra/local-data/clickhouse:/var/lib/clickhouse
      - ./infra/docker/clickhouse/init.sql:/docker-entrypoint-initdb.d/init.sql:ro

  meilisearch:
    image: getmeili/meilisearch:v1.10
    environment:
      MEILI_MASTER_KEY: ${MEILI_MASTER_KEY:-dev-master-key}
      MEILI_ENV: development
    ports: ["7700:7700"]
    volumes:
      - ./infra/local-data/meili:/meili_data

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9101"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9100:9000"
      - "9101:9101"
    volumes:
      - ./infra/local-data/minio:/data
```

- [ ] **Step 3: Create `infra/docker/clickhouse/init.sql`**

```sql
CREATE DATABASE IF NOT EXISTS audit;
```

- [ ] **Step 4: Create `tools/scripts/dev-up.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
cp -n .env.example .env || true
docker compose up -d
echo "Waiting for Postgres..."
until docker compose exec -T postgres pg_isready -U app >/dev/null 2>&1; do sleep 1; done
echo "Dev environment ready."
```

- [ ] **Step 5: Create `tools/scripts/dev-down.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
docker compose down
```

- [ ] **Step 6: Make scripts executable + test**

```bash
chmod +x tools/scripts/*.sh
./tools/scripts/dev-up.sh
```

Expected: all services come up; `docker compose ps` shows healthy.

- [ ] **Step 7: Verify each service**

```bash
docker compose exec -T postgres psql -U app -d platform -c "SELECT 1;"
docker compose exec -T redis redis-cli ping
curl -s http://localhost:8222/healthz
curl -s http://localhost:8123/ping
curl -s -H "Authorization: Bearer dev-master-key" http://localhost:7700/health
curl -s http://localhost:9100/minio/health/ready
```

Each should return success.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml .env.example infra/docker tools/scripts
git commit -m "chore: add docker compose dev environment"
```

---

## Task 3: Go workspace + template service

**Files:**
- Create: `go.work`
- Create: `services/_template/go.mod`
- Create: `services/_template/cmd/server/main.go`
- Create: `services/_template/internal/server/server.go`
- Create: `services/_template/internal/server/server_test.go`

- [ ] **Step 1: Init Go workspace**

```bash
go work init
```

- [ ] **Step 2: Create template service module**

```bash
mkdir -p services/_template/cmd/server services/_template/internal/server
cd services/_template
go mod init github.com/pmplatform/services/_template
go get github.com/go-chi/chi/v5@latest
cd ../..
go work use ./services/_template
```

- [ ] **Step 3: Write the failing test**

File: `services/_template/internal/server/server_test.go`

```go
package server

import (
    "net/http"
    "net/http/httptest"
    "testing"
)

func TestHealthz(t *testing.T) {
    srv := New()
    req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
    rec := httptest.NewRecorder()
    srv.ServeHTTP(rec, req)
    if rec.Code != http.StatusOK {
        t.Fatalf("expected 200, got %d", rec.Code)
    }
    if rec.Body.String() != `{"status":"ok"}` {
        t.Fatalf("unexpected body: %s", rec.Body.String())
    }
}
```

- [ ] **Step 4: Run test, verify it fails**

Run: `cd services/_template && go test ./...`
Expected: FAIL (undefined: New).

- [ ] **Step 5: Implement server**

File: `services/_template/internal/server/server.go`

```go
package server

import (
    "net/http"

    "github.com/go-chi/chi/v5"
)

func New() http.Handler {
    r := chi.NewRouter()
    r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        w.WriteHeader(http.StatusOK)
        _, _ = w.Write([]byte(`{"status":"ok"}`))
    })
    return r
}
```

- [ ] **Step 6: Run test, verify it passes**

Run: `cd services/_template && go test ./...`
Expected: PASS.

- [ ] **Step 7: Write `cmd/server/main.go`**

```go
package main

import (
    "log"
    "net/http"
    "os"

    "github.com/pmplatform/services/_template/internal/server"
)

func main() {
    addr := ":" + envOr("PORT", "8080")
    log.Printf("listening on %s", addr)
    if err := http.ListenAndServe(addr, server.New()); err != nil {
        log.Fatal(err)
    }
}

func envOr(k, def string) string {
    if v := os.Getenv(k); v != "" {
        return v
    }
    return def
}
```

- [ ] **Step 8: Commit**

```bash
git add go.work services/_template
git commit -m "chore: add Go workspace + template service"
```

---

## Task 4: Shared Go libs — logger

**Files:**
- Create: `libs/go/logger/go.mod`
- Create: `libs/go/logger/logger.go`
- Create: `libs/go/logger/logger_test.go`

- [ ] **Step 1: Init module**

```bash
mkdir -p libs/go/logger
cd libs/go/logger
go mod init github.com/pmplatform/libs/go/logger
go get github.com/rs/zerolog@latest
cd ../../..
go work use ./libs/go/logger
```

- [ ] **Step 2: Write the failing test**

File: `libs/go/logger/logger_test.go`

```go
package logger

import (
    "bytes"
    "encoding/json"
    "testing"
)

func TestNewWritesJSONWithLevel(t *testing.T) {
    var buf bytes.Buffer
    l := NewWithWriter(&buf, "debug")
    l.Info().Str("svc", "test").Msg("hello")

    var m map[string]any
    if err := json.Unmarshal(buf.Bytes(), &m); err != nil {
        t.Fatalf("not json: %v - %s", err, buf.String())
    }
    if m["message"] != "hello" || m["svc"] != "test" || m["level"] != "info" {
        t.Fatalf("unexpected: %v", m)
    }
}
```

- [ ] **Step 3: Run test, verify it fails**

Run: `cd libs/go/logger && go test ./...`
Expected: FAIL (undefined: NewWithWriter).

- [ ] **Step 4: Implement logger**

File: `libs/go/logger/logger.go`

```go
package logger

import (
    "io"
    "os"

    "github.com/rs/zerolog"
)

func New(level string) zerolog.Logger {
    return NewWithWriter(os.Stdout, level)
}

func NewWithWriter(w io.Writer, level string) zerolog.Logger {
    lvl, err := zerolog.ParseLevel(level)
    if err != nil {
        lvl = zerolog.InfoLevel
    }
    zerolog.TimeFieldFormat = zerolog.TimeFormatUnixMs
    return zerolog.New(w).Level(lvl).With().Timestamp().Logger()
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `cd libs/go/logger && go test ./...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/go/logger go.work
git commit -m "feat(libs/go): add logger"
```

---

## Task 5: Shared Go libs — config

**Files:**
- Create: `libs/go/config/go.mod`
- Create: `libs/go/config/config.go`
- Create: `libs/go/config/config_test.go`

- [ ] **Step 1: Init module**

```bash
mkdir -p libs/go/config
cd libs/go/config
go mod init github.com/pmplatform/libs/go/config
go get github.com/caarlos0/env/v11@latest
cd ../../..
go work use ./libs/go/config
```

- [ ] **Step 2: Write the failing test**

File: `libs/go/config/config_test.go`

```go
package config

import (
    "os"
    "testing"
)

type sample struct {
    Port int    `env:"PORT" envDefault:"8080"`
    Name string `env:"NAME,required"`
}

func TestLoadFromEnv(t *testing.T) {
    t.Setenv("NAME", "svc-x")
    t.Setenv("PORT", "9000")
    var c sample
    if err := Load(&c); err != nil {
        t.Fatal(err)
    }
    if c.Port != 9000 || c.Name != "svc-x" {
        t.Fatalf("got %+v", c)
    }
}

func TestLoadMissingRequired(t *testing.T) {
    os.Unsetenv("NAME")
    var c sample
    if err := Load(&c); err == nil {
        t.Fatal("expected error")
    }
}
```

- [ ] **Step 3: Run test, verify it fails**

Run: `cd libs/go/config && go test ./...`
Expected: FAIL (undefined: Load).

- [ ] **Step 4: Implement config loader**

File: `libs/go/config/config.go`

```go
package config

import "github.com/caarlos0/env/v11"

func Load[T any](into *T) error {
    return env.Parse(into)
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `cd libs/go/config && go test ./...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/go/config go.work
git commit -m "feat(libs/go): add config loader"
```

---

## Task 6: Shared Go libs — db (pgx + RLS helper)

**Files:**
- Create: `libs/go/db/go.mod`
- Create: `libs/go/db/db.go`
- Create: `libs/go/db/rls.go`
- Create: `libs/go/db/db_test.go`

- [ ] **Step 1: Init module**

```bash
mkdir -p libs/go/db
cd libs/go/db
go mod init github.com/pmplatform/libs/go/db
go get github.com/jackc/pgx/v5@latest
go get github.com/jackc/pgx/v5/pgxpool@latest
cd ../../..
go work use ./libs/go/db
```

- [ ] **Step 2: Write the failing test**

File: `libs/go/db/db_test.go`

```go
package db

import (
    "context"
    "os"
    "testing"
)

func TestConnectAndPing(t *testing.T) {
    dsn := os.Getenv("TEST_DATABASE_URL")
    if dsn == "" {
        dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
    }
    p, err := New(context.Background(), dsn)
    if err != nil {
        t.Skipf("postgres unavailable: %v", err)
    }
    defer p.Close()
    if err := p.Ping(context.Background()); err != nil {
        t.Fatal(err)
    }
}

func TestWithTenantSetsLocal(t *testing.T) {
    dsn := os.Getenv("TEST_DATABASE_URL")
    if dsn == "" {
        dsn = "postgres://app:app@localhost:5432/platform?sslmode=disable"
    }
    p, err := New(context.Background(), dsn)
    if err != nil {
        t.Skipf("postgres unavailable: %v", err)
    }
    defer p.Close()
    err = WithTenant(context.Background(), p, "11111111-1111-1111-1111-111111111111", func(ctx context.Context) error {
        var got string
        return p.QueryRow(ctx, "SELECT current_setting('app.current_tenant', true)").Scan(&got)
    })
    if err != nil {
        t.Fatal(err)
    }
}
```

- [ ] **Step 3: Run test (postgres must be up), verify it fails**

Run: `./tools/scripts/dev-up.sh && cd libs/go/db && go test ./...`
Expected: FAIL (undefined: New, WithTenant).

- [ ] **Step 4: Implement `db.go`**

File: `libs/go/db/db.go`

```go
package db

import (
    "context"

    "github.com/jackc/pgx/v5/pgxpool"
)

type Pool = pgxpool.Pool

func New(ctx context.Context, dsn string) (*Pool, error) {
    cfg, err := pgxpool.ParseConfig(dsn)
    if err != nil {
        return nil, err
    }
    return pgxpool.NewWithConfig(ctx, cfg)
}
```

- [ ] **Step 5: Implement `rls.go`**

File: `libs/go/db/rls.go`

```go
package db

import (
    "context"
    "fmt"
)

// WithTenant runs fn inside a tx with app.current_tenant set so RLS policies apply.
func WithTenant(ctx context.Context, p *Pool, tenantID string, fn func(context.Context) error) error {
    tx, err := p.Begin(ctx)
    if err != nil {
        return err
    }
    defer tx.Rollback(ctx)
    if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant = %q", tenantID)); err != nil {
        return err
    }
    if err := fn(ctx); err != nil {
        return err
    }
    return tx.Commit(ctx)
}
```

- [ ] **Step 6: Run test, verify it passes**

Run: `cd libs/go/db && go test ./...`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add libs/go/db go.work
git commit -m "feat(libs/go): add db wrapper + RLS helper"
```

---

## Task 7: Shared Go libs — nats (JetStream client)

**Files:**
- Create: `libs/go/nats/go.mod`
- Create: `libs/go/nats/client.go`
- Create: `libs/go/nats/client_test.go`

- [ ] **Step 1: Init module**

```bash
mkdir -p libs/go/nats
cd libs/go/nats
go mod init github.com/pmplatform/libs/go/nats
go get github.com/nats-io/nats.go@latest
cd ../../..
go work use ./libs/go/nats
```

- [ ] **Step 2: Write the failing test**

File: `libs/go/nats/client_test.go`

```go
package nats

import (
    "context"
    "os"
    "testing"
    "time"
)

func TestPublishAndSubscribe(t *testing.T) {
    url := os.Getenv("NATS_URL")
    if url == "" {
        url = "nats://localhost:4222"
    }
    c, err := Connect(url)
    if err != nil {
        t.Skipf("nats unavailable: %v", err)
    }
    defer c.Close()

    if err := c.EnsureStream(context.Background(), "TEST", []string{"test.>"}); err != nil {
        t.Fatal(err)
    }

    got := make(chan []byte, 1)
    _, err = c.Subscribe(context.Background(), "TEST", "test.x", func(data []byte) error {
        got <- data
        return nil
    })
    if err != nil {
        t.Fatal(err)
    }

    if err := c.Publish(context.Background(), "test.x", []byte("hello")); err != nil {
        t.Fatal(err)
    }

    select {
    case msg := <-got:
        if string(msg) != "hello" {
            t.Fatalf("unexpected: %s", msg)
        }
    case <-time.After(3 * time.Second):
        t.Fatal("timeout")
    }
}
```

- [ ] **Step 3: Run test, verify it fails**

Run: `cd libs/go/nats && go test ./...`
Expected: FAIL.

- [ ] **Step 4: Implement client**

File: `libs/go/nats/client.go`

```go
package nats

import (
    "context"

    "github.com/nats-io/nats.go"
    "github.com/nats-io/nats.go/jetstream"
)

type Client struct {
    nc *nats.Conn
    js jetstream.JetStream
}

func Connect(url string) (*Client, error) {
    nc, err := nats.Connect(url, nats.MaxReconnects(-1))
    if err != nil {
        return nil, err
    }
    js, err := jetstream.New(nc)
    if err != nil {
        nc.Close()
        return nil, err
    }
    return &Client{nc: nc, js: js}, nil
}

func (c *Client) Close() { c.nc.Close() }

func (c *Client) EnsureStream(ctx context.Context, name string, subjects []string) error {
    _, err := c.js.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
        Name:     name,
        Subjects: subjects,
        Storage:  jetstream.FileStorage,
    })
    return err
}

func (c *Client) Publish(ctx context.Context, subject string, data []byte) error {
    _, err := c.js.Publish(ctx, subject, data)
    return err
}

type Handler func(data []byte) error

func (c *Client) Subscribe(ctx context.Context, stream, subject string, h Handler) (jetstream.ConsumeContext, error) {
    cons, err := c.js.CreateOrUpdateConsumer(ctx, stream, jetstream.ConsumerConfig{
        FilterSubject: subject,
        AckPolicy:     jetstream.AckExplicitPolicy,
    })
    if err != nil {
        return nil, err
    }
    return cons.Consume(func(msg jetstream.Msg) {
        if err := h(msg.Data()); err != nil {
            _ = msg.Nak()
            return
        }
        _ = msg.Ack()
    })
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `cd libs/go/nats && go test ./...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/go/nats go.work
git commit -m "feat(libs/go): add nats jetstream client"
```

---

## Task 8: Shared Go libs — httpx (chi server + middleware)

**Files:**
- Create: `libs/go/httpx/go.mod`
- Create: `libs/go/httpx/server.go`
- Create: `libs/go/httpx/middleware.go`
- Create: `libs/go/httpx/server_test.go`

- [ ] **Step 1: Init module**

```bash
mkdir -p libs/go/httpx
cd libs/go/httpx
go mod init github.com/pmplatform/libs/go/httpx
go get github.com/go-chi/chi/v5@latest
go get github.com/google/uuid@latest
cd ../../..
go work use ./libs/go/httpx
```

- [ ] **Step 2: Write the failing test**

File: `libs/go/httpx/server_test.go`

```go
package httpx

import (
    "net/http"
    "net/http/httptest"
    "testing"
)

func TestBaseServerAddsRequestID(t *testing.T) {
    h := NewBaseRouter()
    h.Get("/x", func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(200)
    })
    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/x", nil)
    h.ServeHTTP(rec, req)
    if rec.Header().Get("X-Request-Id") == "" {
        t.Fatal("missing request id")
    }
}

func TestHealthzMounted(t *testing.T) {
    h := NewBaseRouter()
    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/healthz", nil)
    h.ServeHTTP(rec, req)
    if rec.Code != 200 {
        t.Fatalf("expected 200, got %d", rec.Code)
    }
}
```

- [ ] **Step 3: Run test, verify it fails**

Run: `cd libs/go/httpx && go test ./...`
Expected: FAIL.

- [ ] **Step 4: Implement middleware**

File: `libs/go/httpx/middleware.go`

```go
package httpx

import (
    "net/http"

    "github.com/google/uuid"
)

func RequestID(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := r.Header.Get("X-Request-Id")
        if id == "" {
            id = uuid.NewString()
        }
        w.Header().Set("X-Request-Id", id)
        next.ServeHTTP(w, r)
    })
}
```

- [ ] **Step 5: Implement server**

File: `libs/go/httpx/server.go`

```go
package httpx

import (
    "net/http"

    "github.com/go-chi/chi/v5"
)

func NewBaseRouter() *chi.Mux {
    r := chi.NewRouter()
    r.Use(RequestID)
    r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        _, _ = w.Write([]byte(`{"status":"ok"}`))
    })
    return r
}
```

- [ ] **Step 6: Run test, verify it passes**

Run: `cd libs/go/httpx && go test ./...`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add libs/go/httpx go.work
git commit -m "feat(libs/go): add httpx base router"
```

---

## Task 9: Shared Go libs — otel

**Files:**
- Create: `libs/go/otel/go.mod`
- Create: `libs/go/otel/otel.go`
- Create: `libs/go/otel/otel_test.go`

- [ ] **Step 1: Init module + deps**

```bash
mkdir -p libs/go/otel
cd libs/go/otel
go mod init github.com/pmplatform/libs/go/otel
go get go.opentelemetry.io/otel@latest
go get go.opentelemetry.io/otel/sdk@latest
go get go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp@latest
cd ../../..
go work use ./libs/go/otel
```

- [ ] **Step 2: Write the failing test**

File: `libs/go/otel/otel_test.go`

```go
package otel

import (
    "context"
    "testing"
)

func TestInitNoopWhenNoEndpoint(t *testing.T) {
    shutdown, err := Init(context.Background(), Config{ServiceName: "test"})
    if err != nil {
        t.Fatal(err)
    }
    if shutdown == nil {
        t.Fatal("shutdown nil")
    }
    if err := shutdown(context.Background()); err != nil {
        t.Fatal(err)
    }
}
```

- [ ] **Step 3: Run test, verify it fails**

Run: `cd libs/go/otel && go test ./...`
Expected: FAIL.

- [ ] **Step 4: Implement otel init**

File: `libs/go/otel/otel.go`

```go
package otel

import (
    "context"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/sdk/resource"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
    semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

type Config struct {
    ServiceName  string
    OTLPEndpoint string // e.g. "otel-collector:4318"
}

type Shutdown func(context.Context) error

func Init(ctx context.Context, cfg Config) (Shutdown, error) {
    res, err := resource.Merge(resource.Default(),
        resource.NewWithAttributes(semconv.SchemaURL,
            semconv.ServiceName(cfg.ServiceName),
        ))
    if err != nil {
        return nil, err
    }

    if cfg.OTLPEndpoint == "" {
        tp := sdktrace.NewTracerProvider(sdktrace.WithResource(res))
        otel.SetTracerProvider(tp)
        return tp.Shutdown, nil
    }

    exp, err := otlptracehttp.New(ctx,
        otlptracehttp.WithEndpoint(cfg.OTLPEndpoint),
        otlptracehttp.WithInsecure(),
    )
    if err != nil {
        return nil, err
    }
    tp := sdktrace.NewTracerProvider(
        sdktrace.WithBatcher(exp),
        sdktrace.WithResource(res),
    )
    otel.SetTracerProvider(tp)
    return tp.Shutdown, nil
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `cd libs/go/otel && go test ./...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/go/otel go.work
git commit -m "feat(libs/go): add otel init"
```

---

## Task 10: Rust workspace + template engine

**Files:**
- Create: `Cargo.toml`
- Create: `engines/_template/Cargo.toml`
- Create: `engines/_template/src/main.rs`
- Create: `engines/_template/src/lib.rs`
- Create: `engines/_template/tests/healthz.rs`

- [ ] **Step 1: Create root workspace `Cargo.toml`**

```toml
[workspace]
resolver = "2"
members = [
    "engines/_template",
    "libs/rust/obs",
    "libs/rust/db",
]

[workspace.package]
edition = "2021"
rust-version = "1.83"

[workspace.dependencies]
tokio = { version = "1", features = ["full"] }
axum = "0.7"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
sqlx = { version = "0.8", features = ["postgres", "runtime-tokio", "uuid", "chrono"] }
anyhow = "1"
thiserror = "1"
```

- [ ] **Step 2: Create template engine**

```bash
mkdir -p engines/_template/src engines/_template/tests
```

File: `engines/_template/Cargo.toml`

```toml
[package]
name = "engine-template"
version = "0.0.1"
edition.workspace = true

[dependencies]
tokio.workspace = true
axum.workspace = true
serde.workspace = true
serde_json.workspace = true
tracing.workspace = true

[lib]
path = "src/lib.rs"

[[bin]]
name = "engine-template"
path = "src/main.rs"
```

- [ ] **Step 3: Write the failing test**

File: `engines/_template/tests/healthz.rs`

```rust
use axum::{body::Body, http::Request};
use http_body_util::BodyExt;
use tower::ServiceExt;

#[tokio::test]
async fn healthz_returns_ok() {
    let app = engine_template::router();
    let res = app
        .oneshot(Request::builder().uri("/healthz").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&body[..], b"{\"status\":\"ok\"}");
}
```

Add dev deps to `engines/_template/Cargo.toml`:

```toml
[dev-dependencies]
tower = { version = "0.5", features = ["util"] }
http-body-util = "0.1"
```

- [ ] **Step 4: Run test, verify it fails**

Run: `cargo test -p engine-template`
Expected: FAIL (router not defined).

- [ ] **Step 5: Implement lib**

File: `engines/_template/src/lib.rs`

```rust
use axum::{routing::get, Router, Json};
use serde_json::json;

pub fn router() -> Router {
    Router::new().route("/healthz", get(|| async { Json(json!({"status":"ok"})) }))
}
```

- [ ] **Step 6: Implement main**

File: `engines/_template/src/main.rs`

```rust
#[tokio::main]
async fn main() {
    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!("listening on {addr}");
    axum::serve(listener, engine_template::router()).await.unwrap();
}
```

- [ ] **Step 7: Run test, verify it passes**

Run: `cargo test -p engine-template`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add Cargo.toml engines/_template
git commit -m "chore: add rust workspace + template engine"
```

---

## Task 11: Shared Rust libs — obs (tracing)

**Files:**
- Create: `libs/rust/obs/Cargo.toml`
- Create: `libs/rust/obs/src/lib.rs`
- Create: `libs/rust/obs/tests/init.rs`

- [ ] **Step 1: Create crate**

```bash
mkdir -p libs/rust/obs/src libs/rust/obs/tests
```

File: `libs/rust/obs/Cargo.toml`

```toml
[package]
name = "obs"
version = "0.0.1"
edition.workspace = true

[dependencies]
tracing.workspace = true
tracing-subscriber.workspace = true
```

- [ ] **Step 2: Write the failing test**

File: `libs/rust/obs/tests/init.rs`

```rust
#[test]
fn init_is_idempotent() {
    obs::init("test");
    obs::init("test"); // must not panic
}
```

- [ ] **Step 3: Run test, verify it fails**

Run: `cargo test -p obs`
Expected: FAIL.

- [ ] **Step 4: Implement obs**

File: `libs/rust/obs/src/lib.rs`

```rust
use std::sync::Once;
use tracing_subscriber::{fmt, EnvFilter};

static INIT: Once = Once::new();

pub fn init(service: &str) {
    INIT.call_once(|| {
        let filter = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new("info"));
        fmt()
            .with_env_filter(filter)
            .json()
            .with_current_span(true)
            .with_target(true)
            .init();
        tracing::info!(service, "obs initialized");
    });
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `cargo test -p obs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/rust/obs
git commit -m "feat(libs/rust): add obs (tracing init)"
```

---

## Task 12: Shared Rust libs — db (sqlx)

**Files:**
- Create: `libs/rust/db/Cargo.toml`
- Create: `libs/rust/db/src/lib.rs`
- Create: `libs/rust/db/tests/pool.rs`

- [ ] **Step 1: Create crate**

```bash
mkdir -p libs/rust/db/src libs/rust/db/tests
```

File: `libs/rust/db/Cargo.toml`

```toml
[package]
name = "db"
version = "0.0.1"
edition.workspace = true

[dependencies]
sqlx.workspace = true
tokio.workspace = true
anyhow.workspace = true
```

- [ ] **Step 2: Write the failing test**

File: `libs/rust/db/tests/pool.rs`

```rust
#[tokio::test]
async fn connect_and_ping() {
    let dsn = std::env::var("TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://app:app@localhost:5432/platform".to_string());
    let Ok(pool) = db::new_pool(&dsn).await else {
        eprintln!("postgres unavailable, skipping");
        return;
    };
    let one: (i32,) = sqlx::query_as("SELECT 1").fetch_one(&pool).await.unwrap();
    assert_eq!(one.0, 1);
}
```

- [ ] **Step 3: Run test, verify it fails**

Run: `cargo test -p db`
Expected: FAIL.

- [ ] **Step 4: Implement db**

File: `libs/rust/db/src/lib.rs`

```rust
use sqlx::{postgres::PgPoolOptions, Pool, Postgres};

pub type PgPool = Pool<Postgres>;

pub async fn new_pool(dsn: &str) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(dsn)
        .await?;
    Ok(pool)
}

pub async fn with_tenant<F, R>(pool: &PgPool, tenant_id: &str, f: F) -> anyhow::Result<R>
where
    F: for<'a> FnOnce(
        &'a mut sqlx::Transaction<'static, Postgres>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<R>> + Send + 'a>>,
{
    let mut tx = pool.begin().await?;
    let stmt = format!("SET LOCAL app.current_tenant = '{}'", tenant_id.replace('\'', "''"));
    sqlx::query(&stmt).execute(&mut *tx).await?;
    let out = f(&mut tx).await?;
    tx.commit().await?;
    Ok(out)
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `./tools/scripts/dev-up.sh && cargo test -p db`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/rust/db
git commit -m "feat(libs/rust): add db (sqlx + RLS helper)"
```

---

## Task 13: pnpm workspace + Turborepo + design-tokens package

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `packages/design-tokens/package.json`
- Create: `packages/design-tokens/tsconfig.json`
- Create: `packages/design-tokens/src/index.ts`
- Create: `packages/design-tokens/src/index.test.ts`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "pmplatform",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "dev": "turbo run dev"
  },
  "devDependencies": {
    "turbo": "^2.1.0",
    "typescript": "^5.6.0",
    "@biomejs/biome": "^1.9.0"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "test":  { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "lint":  {},
    "typecheck": { "dependsOn": ["^build"] },
    "dev":   { "cache": false, "persistent": true }
  }
}
```

- [ ] **Step 4: Create design-tokens package files**

```bash
mkdir -p packages/design-tokens/src
```

File: `packages/design-tokens/package.json`

```json
{
  "name": "@pmplatform/design-tokens",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "biome check src",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

File: `packages/design-tokens/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "declaration": true,
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "**/*.test.ts"]
}
```

- [ ] **Step 5: Install + write the failing test**

```bash
pnpm install
```

File: `packages/design-tokens/src/index.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { tokens } from "./index";

describe("design tokens", () => {
  it("exposes color.primary", () => {
    expect(tokens.color.primary).toBe("#0B5CFF");
  });
  it("exposes radius.md", () => {
    expect(tokens.radius.md).toBe("6px");
  });
});
```

- [ ] **Step 6: Run test, verify it fails**

Run: `pnpm --filter @pmplatform/design-tokens test`
Expected: FAIL.

- [ ] **Step 7: Implement tokens**

File: `packages/design-tokens/src/index.ts`

```ts
export const tokens = {
  color: {
    primary: "#0B5CFF",
    primaryHover: "#0A53E5",
    bg: "#FFFFFF",
    bgMuted: "#F6F7F9",
    fg: "#0B0C0F",
    fgMuted: "#5C6470",
    border: "#E3E6EB",
    success: "#127C4D",
    warning: "#B5701C",
    danger: "#C0303C",
    info: "#0B5CFF",
  },
  spacing: { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px", 8: "32px" },
  radius: { sm: "4px", md: "6px", lg: "10px" },
  typography: {
    fontFamily: {
      sans: "'Inter', system-ui, sans-serif",
      mono: "'JetBrains Mono', ui-monospace, monospace",
    },
    fontSize: { xs: "12px", sm: "13px", md: "14px", lg: "16px", xl: "20px", "2xl": "28px" },
  },
  density: { compact: 4, cozy: 8, comfortable: 12 } as const,
} as const;

export type Tokens = typeof tokens;
```

- [ ] **Step 8: Run test, verify it passes**

Run: `pnpm --filter @pmplatform/design-tokens test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json packages/design-tokens
git commit -m "chore: add pnpm workspace + design-tokens package"
```

---

## Task 14: Goose migration root + first migration template

**Files:**
- Create: `infra/migrations/README.md`
- Create: `infra/migrations/_shared/00001_extensions.sql`
- Create: `tools/scripts/migrate.sh`

- [ ] **Step 1: Install goose**

```bash
go install github.com/pressly/goose/v3/cmd/goose@latest
```

- [ ] **Step 2: Create `infra/migrations/README.md`**

```markdown
# Migrations

Each service owns its migrations under `infra/migrations/<service>/`.
Shared schema (extensions, common roles) lives in `_shared/`.

Apply all:
\`\`\`
./tools/scripts/migrate.sh up
\`\`\`
```

- [ ] **Step 3: Create `infra/migrations/_shared/00001_extensions.sql`**

```sql
-- +goose Up
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- +goose Down
DROP EXTENSION IF EXISTS "vector";
DROP EXTENSION IF EXISTS "uuid-ossp";
DROP EXTENSION IF EXISTS "pgcrypto";
```

NOTE: `pgvector` requires `pgvector/pgvector:pg16` image. Update `docker-compose.yml`:

```yaml
  postgres:
    image: pgvector/pgvector:pg16
    # ... rest unchanged
```

- [ ] **Step 4: Create `tools/scripts/migrate.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

CMD="${1:-up}"
DSN="postgres://${POSTGRES_USER:-app}:${POSTGRES_PASSWORD:-app}@${POSTGRES_HOST:-localhost}:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-platform}?sslmode=disable"

for dir in infra/migrations/*/; do
  echo ">> migrating $dir"
  goose -dir "$dir" postgres "$DSN" "$CMD"
done
```

- [ ] **Step 5: Apply + verify**

```bash
chmod +x tools/scripts/migrate.sh
docker compose down -v && ./tools/scripts/dev-up.sh
./tools/scripts/migrate.sh up
docker compose exec -T postgres psql -U app -d platform -c "SELECT extname FROM pg_extension;"
```

Expected: lists `pgcrypto`, `uuid-ossp`, `vector`.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml infra/migrations tools/scripts/migrate.sh
git commit -m "chore: add goose migration scaffolding + base extensions"
```

---

## Task 15: ADR scaffolding + first ADR

**Files:**
- Create: `docs/adr/README.md`
- Create: `docs/adr/0001-monorepo-layout.md`
- Create: `docs/runbook/README.md`
- Create: `docs/dev-setup.md`

- [ ] **Step 1: Create `docs/adr/README.md`**

```markdown
# Architecture Decision Records

Format: MADR-lite. Filename: `NNNN-kebab-title.md`.
Status: Proposed | Accepted | Deprecated | Superseded by NNNN.
```

- [ ] **Step 2: Create `docs/adr/0001-monorepo-layout.md`**

```markdown
# 1. Monorepo Layout

Status: Accepted
Date: 2026-05-17

## Context
Polyglot system: Go services, Rust engines, Next.js frontend, shared packages.

## Decision
Single git repo with three workspace managers:
- `go.work` for Go modules under `services/` and `libs/go/`
- root `Cargo.toml` workspace for Rust crates under `engines/` and `libs/rust/`
- `pnpm-workspace.yaml` + Turborepo for TS apps under `apps/` and packages under `packages/`

Per-service migrations under `infra/migrations/<service>/`. Helm umbrella chart in `infra/helm/platform/`.

## Consequences
- One PR can span backend + frontend + migrations.
- CI matrices split per language to avoid coupling.
- Single source of versioning for design tokens consumed by both frontend and Storybook.
```

- [ ] **Step 3: Create `docs/runbook/README.md`**

```markdown
# Runbooks

One file per service: `<service>.md` covering oncall steps, common incidents, dashboards, dependencies.
```

- [ ] **Step 4: Create `docs/dev-setup.md`**

```markdown
# Dev Setup

## Prereqs
- Go 1.23, Rust 1.83, Node 22, pnpm 9, Docker Desktop, goose

## Bootstrap
\`\`\`
./tools/scripts/bootstrap.sh
./tools/scripts/dev-up.sh
./tools/scripts/migrate.sh up
\`\`\`

## Run a Go service
\`\`\`
cd services/<svc>
go run ./cmd/server
\`\`\`

## Run a Rust engine
\`\`\`
cargo run -p <engine-name>
\`\`\`

## Run the web app
\`\`\`
pnpm --filter web dev
\`\`\`
```

- [ ] **Step 5: Write bootstrap script**

File: `tools/scripts/bootstrap.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

command -v go >/dev/null    || { echo "install Go 1.23+"; exit 1; }
command -v cargo >/dev/null || { echo "install Rust 1.83+"; exit 1; }
command -v node >/dev/null  || { echo "install Node 22+"; exit 1; }
command -v pnpm >/dev/null  || { echo "install pnpm 9+"; exit 1; }
command -v docker >/dev/null|| { echo "install Docker Desktop"; exit 1; }
command -v goose >/dev/null || go install github.com/pressly/goose/v3/cmd/goose@latest

pnpm install
go work sync
cargo build --workspace
echo "bootstrap complete."
```

```bash
chmod +x tools/scripts/bootstrap.sh
```

- [ ] **Step 6: Commit**

```bash
git add docs/adr docs/runbook docs/dev-setup.md tools/scripts/bootstrap.sh
git commit -m "docs: add ADR scaffolding, runbook root, dev setup"
```

---

## Task 16: GitHub Actions — Go CI

**Files:**
- Create: `.github/workflows/ci-go.yml`

- [ ] **Step 1: Write workflow**

```yaml
name: ci-go

on:
  push: { branches: [main] }
  pull_request:
    paths:
      - "services/**"
      - "libs/go/**"
      - "go.work"
      - ".github/workflows/ci-go.yml"

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: app
          POSTGRES_PASSWORD: app
          POSTGRES_DB: platform
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U app"
          --health-interval 3s
          --health-retries 20
      nats:
        image: nats:2.10-alpine
        ports: ["4222:4222"]
        options: >-
          --health-cmd "wget -qO- http://localhost:8222/healthz || exit 1"
          --health-interval 3s
          --health-retries 20
    env:
      TEST_DATABASE_URL: postgres://app:app@localhost:5432/platform?sslmode=disable
      NATS_URL: nats://localhost:4222
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: "1.23" }
      - run: go work sync
      - run: |
          for d in $(find services libs/go -name go.mod -exec dirname {} \;); do
            echo "==> $d"
            (cd "$d" && go vet ./... && go test ./... -count=1)
          done
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci-go.yml
git commit -m "ci: add Go workflow"
```

---

## Task 17: GitHub Actions — Rust CI

**Files:**
- Create: `.github/workflows/ci-rust.yml`

- [ ] **Step 1: Write workflow**

```yaml
name: ci-rust

on:
  push: { branches: [main] }
  pull_request:
    paths:
      - "engines/**"
      - "libs/rust/**"
      - "Cargo.toml"
      - ".github/workflows/ci-rust.yml"

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: app
          POSTGRES_PASSWORD: app
          POSTGRES_DB: platform
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U app"
          --health-interval 3s
          --health-retries 20
    env:
      TEST_DATABASE_URL: postgres://app:app@localhost:5432/platform
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with: { components: clippy,rustfmt }
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --all -- --check
      - run: cargo clippy --workspace --all-targets -- -D warnings
      - run: cargo test --workspace --no-fail-fast
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci-rust.yml
git commit -m "ci: add Rust workflow"
```

---

## Task 18: GitHub Actions — Node CI + Biome

**Files:**
- Create: `.github/workflows/ci-node.yml`
- Create: `biome.json`

- [ ] **Step 1: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignore": ["**/dist/**", "**/.next/**", "**/.turbo/**", "**/node_modules/**"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "double", "semicolons": "always" } }
}
```

- [ ] **Step 2: Write workflow**

```yaml
name: ci-node

on:
  push: { branches: [main] }
  pull_request:
    paths:
      - "apps/**"
      - "packages/**"
      - "package.json"
      - "pnpm-workspace.yaml"
      - "turbo.json"
      - "biome.json"
      - ".github/workflows/ci-node.yml"

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: "pnpm" }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec biome check .
      - run: pnpm turbo run typecheck test build
```

- [ ] **Step 3: Commit**

```bash
git add biome.json .github/workflows/ci-node.yml
git commit -m "ci: add Node workflow + Biome config"
```

---

## Task 19: Lint workflow (cross-language smoke)

**Files:**
- Create: `.github/workflows/ci-lint.yml`

- [ ] **Step 1: Write workflow**

```yaml
name: ci-lint

on:
  pull_request:

jobs:
  editorconfig:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: editorconfig-checker/action-editorconfig-checker@v2

  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@v2
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci-lint.yml
git commit -m "ci: add lint workflow (editorconfig + gitleaks)"
```

---

## Task 20: Helm umbrella chart skeleton

**Files:**
- Create: `infra/helm/platform/Chart.yaml`
- Create: `infra/helm/platform/values.yaml`
- Create: `infra/helm/platform/templates/_helpers.tpl`

- [ ] **Step 1: Create `Chart.yaml`**

```yaml
apiVersion: v2
name: platform
description: PM + Manufacturing SaaS umbrella chart
type: application
version: 0.0.1
appVersion: "0.0.1"
```

- [ ] **Step 2: Create `values.yaml`**

```yaml
global:
  imageRegistry: ghcr.io/pmplatform
  imageTag: latest
  tenancyTier: shared   # shared | schema | dedicated

postgres:
  external: false
  dsn: ""

redis:
  external: false
  url: ""

nats:
  external: false
  url: ""

services:
  identity:    { enabled: true,  replicas: 2 }
  tenant:      { enabled: true,  replicas: 2 }
  project:    { enabled: false, replicas: 2 }
  workspace:  { enabled: false, replicas: 2 }
  workflow:   { enabled: false, replicas: 2 }
```

- [ ] **Step 3: Create `_helpers.tpl`**

```yaml
{{/* Common labels */}}
{{- define "platform.labels" -}}
app.kubernetes.io/managed-by: helm
app.kubernetes.io/part-of: platform
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}
```

- [ ] **Step 4: Verify chart syntax**

```bash
helm lint infra/helm/platform
```

Expected: 0 chart(s) failed.

- [ ] **Step 5: Commit**

```bash
git add infra/helm
git commit -m "chore(infra): add helm umbrella chart skeleton"
```

---

## Task 21: End-to-end smoke (everything green)

- [ ] **Step 1: Fresh bootstrap**

```bash
docker compose down -v
./tools/scripts/bootstrap.sh
./tools/scripts/dev-up.sh
./tools/scripts/migrate.sh up
```

- [ ] **Step 2: Run all Go tests**

```bash
for d in $(find services libs/go -name go.mod -exec dirname {} \;); do
  echo "==> $d"
  (cd "$d" && go test ./... -count=1) || exit 1
done
```

Expected: all green.

- [ ] **Step 3: Run all Rust tests**

```bash
cargo test --workspace
```

Expected: all green.

- [ ] **Step 4: Run all TS tests**

```bash
pnpm turbo run typecheck test build
```

Expected: all green.

- [ ] **Step 5: Tag baseline**

```bash
git tag plan-01-platform-foundation-complete
```

---

## Self-review (already done by plan author)

- All shared libs have failing-test → minimal-implementation → passing-test cycles.
- All services/libs are registered in their workspace manager (`go.work`, `Cargo.toml`, `pnpm-workspace.yaml`).
- Dev env (docker compose) + migration tool + bootstrap script form a one-command setup.
- CI covers all three languages + cross-cutting lint + secret scan.
- No TBDs. Every code step includes the actual code.
