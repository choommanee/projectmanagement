# Plan #12 — OTEL Tracing + Prometheus Metrics + Grafana

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire OpenTelemetry tracing and Prometheus metrics to all Go services, and add a Grafana + Jaeger compose profile for local observability.

**Architecture:** `libs/go/otel` already provides `SetupOTLP()`. Each service just needs to call it at boot and instrument its chi router with the OTEL middleware. Prometheus metrics are added via `promhttp.Handler()` on `/metrics`. A new `infra/compose/observability.yml` compose override adds otel-collector, Jaeger, Prometheus, and Grafana.

**Tech Stack:** `go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp`, `github.com/prometheus/client_golang`, Docker Compose profiles.

**Services to instrument:** identity-svc (8082), tenant-svc (8081), project-svc (8083), document-svc (8084), mfg-svc (8085), quality-svc (8087), workflow-svc (8090), notification-svc (8093), audit-svc (8089), reports-svc (8092).

---

## File Map

```
Modified (Go — all services):
  services/*/cmd/server/main.go                   call otel.SetupOTLP() + register /metrics

New / Modified (shared lib):
  libs/go/otel/otel.go                            verify SetupOTLP + add PrometheusHandler helper

New (Infra):
  infra/compose/observability.yml                 otel-collector, Jaeger, Prometheus, Grafana
  infra/otel-collector/config.yml                 OTLP receiver → Jaeger + Prometheus exporter
  infra/grafana/provisioning/datasources/ds.yml   auto-provision Prometheus + Jaeger data sources
  infra/grafana/provisioning/dashboards/go-services.json  basic Go service dashboard
```

---

### Task A — Verify and extend libs/go/otel

**Files:**
- Modify: `libs/go/otel/otel.go`

- [ ] **Step 1: Check current otel lib**

```bash
cat libs/go/otel/otel.go
```

Verify it exports `SetupOTLP(ctx context.Context, serviceName string) (func(), error)`. If the function signature is different, note the actual signature.

- [ ] **Step 2: Add Prometheus handler helper**

In `libs/go/otel/otel.go`, add at the end of the file (after existing code):

```go
import "github.com/prometheus/client_golang/prometheus/promhttp"

// PrometheusHandler returns the default Prometheus metrics HTTP handler.
// Mount it at GET /metrics in every service.
func PrometheusHandler() http.Handler {
	return promhttp.Handler()
}
```

Add the import to the import block if not already present:
```go
"github.com/prometheus/client_golang/prometheus/promhttp"
"net/http"
```

- [ ] **Step 3: Add dependency to libs/go/otel/go.mod**

```bash
cd libs/go/otel && go get github.com/prometheus/client_golang@latest && go mod tidy
```

- [ ] **Step 4: Build check**

```bash
cd libs/go/otel && go build ./...
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add libs/go/otel/
git commit -m "feat(libs/otel): add PrometheusHandler helper (Plan #12 Task A)"
```

---

### Task B — Instrument all Go services

Repeat the following steps for **each service**: `identity-svc`, `tenant-svc`, `project-svc`, `document-svc`, `mfg-svc`, `quality-svc`, `workflow-svc`, `notification-svc`, `audit-svc`, `reports-svc`.

**Files:**
- Modify: `services/<svc>/cmd/server/main.go`

- [ ] **Step 1: For each service — add OTEL init to main.go**

In `services/<svc>/cmd/server/main.go`, find the `main()` function. After reading config/env vars, add before the router is created:

```go
import (
    libotel "github.com/your-org/pm-platform/libs/go/otel"
    "go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// In main(), after config setup:
shutdown, err := libotel.SetupOTLP(ctx, "<service-name>")  // e.g. "project-svc"
if err != nil {
    log.Printf("WARN: OTEL setup failed (continuing without tracing): %v", err)
} else {
    defer shutdown()
}
```

- [ ] **Step 2: Wrap chi router with OTEL HTTP middleware**

Find where `httpx.NewServer` or `chi.NewRouter()` is called. Wrap the router handler:

```go
// If using httpx.NewServer(router, ...) — wrap the handler:
tracedHandler := otelhttp.NewHandler(router, "<service-name>")
server := &http.Server{Addr: cfg.Addr, Handler: tracedHandler}
```

- [ ] **Step 3: Add /metrics endpoint**

In the router setup (before the v1 route group), add:

```go
import libotel "github.com/your-org/pm-platform/libs/go/otel"

r.Get("/metrics", func(w http.ResponseWriter, r *http.Request) {
    libotel.PrometheusHandler().ServeHTTP(w, r)
})
```

- [ ] **Step 4: Add go.mod dependency for otelhttp**

```bash
cd services/<svc> && go get go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp@latest && go mod tidy
```

- [ ] **Step 5: Build check**

```bash
cd services/<svc> && go build ./...
```

Expected: no errors

- [ ] **Step 6: Commit after all 10 services are done**

```bash
git add services/
git commit -m "feat(services): OTEL tracing + Prometheus /metrics on all 10 services (Plan #12 Task B)"
```

---

### Task C — otel-collector config

**Files:**
- Create: `infra/otel-collector/config.yml`

- [ ] **Step 1: Create collector config**

Create `infra/otel-collector/config.yml`:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: "0.0.0.0:4317"
      http:
        endpoint: "0.0.0.0:4318"

processors:
  batch:
    timeout: 5s
    send_batch_size: 256

exporters:
  otlp/jaeger:
    endpoint: "jaeger:4317"
    tls:
      insecure: true
  prometheus:
    endpoint: "0.0.0.0:8889"
    namespace: "pmplatform"

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/jaeger]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheus]
```

- [ ] **Step 2: Commit**

```bash
git add infra/otel-collector/
git commit -m "feat(infra): otel-collector config (Plan #12 Task C)"
```

---

### Task D — Grafana provisioning

**Files:**
- Create: `infra/grafana/provisioning/datasources/ds.yml`
- Create: `infra/grafana/provisioning/dashboards/provider.yml`

- [ ] **Step 1: Create Grafana datasource provisioning**

Create `infra/grafana/provisioning/datasources/ds.yml`:

```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: false

  - name: Jaeger
    type: jaeger
    access: proxy
    url: http://jaeger:16686
    editable: false
```

Create `infra/grafana/provisioning/dashboards/provider.yml`:

```yaml
apiVersion: 1
providers:
  - name: default
    folder: PM Platform
    type: file
    options:
      path: /etc/grafana/provisioning/dashboards
```

- [ ] **Step 2: Commit**

```bash
git add infra/grafana/
git commit -m "feat(infra): Grafana datasource provisioning (Plan #12 Task D)"
```

---

### Task E — Docker Compose observability profile

**Files:**
- Create: `infra/compose/observability.yml`

- [ ] **Step 1: Create compose override**

Create `infra/compose/observability.yml`:

```yaml
version: "3.9"

services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.100.0
    command: ["--config=/etc/otel/config.yml"]
    volumes:
      - ../otel-collector/config.yml:/etc/otel/config.yml:ro
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
      - "8889:8889"   # Prometheus scrape target
    networks: [platform]

  jaeger:
    image: jaegertracing/all-in-one:1.57
    environment:
      COLLECTOR_OTLP_ENABLED: "true"
    ports:
      - "16686:16686" # Jaeger UI
      - "4317"        # internal OTLP
    networks: [platform]

  prometheus:
    image: prom/prometheus:v2.51.0
    volumes:
      - ../prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    ports:
      - "9090:9090"
    networks: [platform]

  grafana:
    image: grafana/grafana:10.4.0
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: "true"
      GF_AUTH_ANONYMOUS_ORG_ROLE: "Viewer"
    volumes:
      - ../grafana/provisioning:/etc/grafana/provisioning:ro
    ports:
      - "3001:3000"   # Grafana UI (3000 is Next.js)
    depends_on: [prometheus, jaeger]
    networks: [platform]

networks:
  platform:
    name: pmplatform
```

- [ ] **Step 2: Create Prometheus scrape config**

Create `infra/prometheus/prometheus.yml`:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: otel-collector
    static_configs:
      - targets: ["otel-collector:8889"]

  - job_name: pm-services
    static_configs:
      - targets:
          - "host.docker.internal:8081"  # tenant-svc
          - "host.docker.internal:8082"  # identity-svc
          - "host.docker.internal:8083"  # project-svc
          - "host.docker.internal:8084"  # document-svc
          - "host.docker.internal:8085"  # mfg-svc
          - "host.docker.internal:8087"  # quality-svc
          - "host.docker.internal:8089"  # audit-svc
          - "host.docker.internal:8090"  # workflow-svc
          - "host.docker.internal:8092"  # reports-svc
          - "host.docker.internal:8093"  # notification-svc
        metrics_path: /metrics
```

- [ ] **Step 3: Add make targets to Makefile (or document in README)**

Add to the repo's `Makefile` (create if not present at root):

```makefile
obs-up:
	docker compose -f infra/compose/observability.yml up -d

obs-down:
	docker compose -f infra/compose/observability.yml down

jaeger:
	open http://localhost:16686

grafana:
	open http://localhost:3001
```

- [ ] **Step 4: Test the stack**

```bash
make obs-up
# Wait ~10s for services to start
curl -s http://localhost:9090/-/healthy  # Prometheus healthy
curl -s http://localhost:16686/         # Jaeger UI
# Start any Go service and hit an endpoint, then check Jaeger for traces
```

Expected: Prometheus returns `Prometheus Server is Healthy.`, Jaeger UI loads.

- [ ] **Step 5: Commit**

```bash
git add infra/
git commit -m "feat(infra): observability stack — otel-collector, Jaeger, Prometheus, Grafana (Plan #12 Task E)"
```

---

### Task F — Environment variables documentation

- [ ] **Step 1: Update env.example**

In `.env.example` (or create at repo root), add:

```bash
# OTEL — set OTEL_EXPORTER_OTLP_ENDPOINT to enable tracing
# Leave empty to disable tracing (no-op exporter)
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=project-svc  # override per service in Dockerfile/K8s

# Prometheus — /metrics endpoint is always on, no config needed
```

- [ ] **Step 2: Final commit**

```bash
git add .env.example
git commit -m "feat(platform): Plan #12 complete — OTEL + Prometheus + Grafana observability"
```
