# PM + Manufacturing SaaS — Design Spec

**Date:** 2026-05-17
**Status:** Approved (brainstorming phase)
**Target customers:** (C) Enterprise / Tier-1 manufacturers + (D) Software houses / IT consulting serving manufacturers
**Goal:** Multi-tenant SaaS product, real implementation (not mockup), modern stack, MS Dynamics 365-style UX

---

## 1. Scope & Phasing

This document defines **Phase 1 (MVP)** of a larger product. Out of scope for Phase 1 (deferred to later phases):
Resource capacity planning UI, full timesheet/approval, MRP-II/APS, shop floor IoT, Inventory/Warehouse, Maintenance, Cost accounting, Financial integration, real-time collaborative editing (CRDT).

Phase 1 anchors on **Manufacturing** as the primary vertical, augmented by **PM Core + Role Workspaces (PM/BA/SA/Expert)** and a **Workflow Automation engine** as core differentiators.

---

## 2. System Architecture

### 2.1 Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15 (App Router, RSC, Server Actions), TypeScript, Tailwind, shadcn/ui (customized to Dynamics style), TanStack Query, Zustand |
| API Gateway / BFF | Go (chi/echo) — auth, routing, aggregation, websocket hub |
| Core services (Go) | identity, project, workspace, document, notification, integration, tenant, workflow (definition) |
| Compute-heavy services (Rust) | mrp-engine, scheduler, traceability-engine, workflow-runtime |
| Workflow DSL | JSON, BPMN-2.0 lite subset, versioned in DB |
| Primary DB | PostgreSQL 16 (RLS for multi-tenancy) |
| Cache / pubsub | Redis |
| Analytics / audit / time-series | ClickHouse |
| Object storage | S3-compatible |
| Search | Meilisearch (or Typesense) |
| Vector search | pgvector |
| Message bus | NATS JetStream |
| Realtime | WebSocket via Go gateway |
| Auth | OIDC (in-house IdP svc) + SAML/OIDC federation for enterprise + WebAuthn |

### 2.2 Deployment shape (agnostic)
All services containerized, stateless, config via env. Helm chart for K8s + Docker Compose for dev. Deployment topology (shared SaaS / dedicated / on-prem) is a per-customer decision; architecture must not assume.

### 2.3 Service topology

```
[ Next.js frontend ]  ──WS/HTTP──▶ [ Go BFF / Gateway ]
                                          │
        ┌──────────────┬──────────────┬───┴─────────┬────────────────┬────────────────┐
        ▼              ▼              ▼             ▼                ▼                ▼
   identity-svc   project-svc   workspace-svc   notif-svc      integration-svc   tenant-svc
        │              │              │             │                │                │
        └──────────────┴───── NATS JetStream ──────┴────────────────┘                 │
                                          │                                            │
                  ┌───────────────────────┼──────────────────────────┐                 │
                  ▼                       ▼                          ▼                 │
           mrp-engine (Rust)    workflow-runtime (Rust)     traceability-engine (Rust) │
                  │                       │                          │                 │
                  └─────── PostgreSQL (RLS) / ClickHouse / Redis / S3 ─────────────────┘
```

---

## 3. Module Breakdown (MVP)

### 3.1 PM Core (`project-svc`)

**Hierarchy:** Portfolio → Program → Project → Workstream
**Task model:** Task / Subtask / Milestone / Deliverable / Issue / Risk / Bug — polymorphic by `type`, each with own field schema
**Task fields:** title, type, status, priority, assignee(s), reviewer, start, due, estimate (manday/hour), actual, % complete, dependency, tag, custom fields
**Dependencies:** FS / SS / FF / SF with lag
**Sprint / Kanban / Scrum:** board view, swimlane, WIP limit, burndown
**Estimation:** story point + hour, velocity tracking; 3-point PERT with confidence level
**Baseline:** versioned schedule + scope snapshot for EVM (Earned Value Management)

**Split planning (Work Breakdown):**
- WBS tree editor (drag-drop reparent, indent/outdent)
- "Split task" action: break parent → children, distribute estimate proportionally
- Rolling-wave planning: `planning_horizon = near | far`; far tasks are placeholders
- Template library: save reusable WBS patterns (e.g., "Standard CR delivery = 12 tasks")

**Timeline / Gantt:**
- Gantt (canvas-rendered, no third-party lib): dependency arrows, critical path, baseline overlay, today marker, drag-to-reschedule, indent for hierarchy, milestone diamonds
- Timeline swimlane by assignee / team / workstream — zoom day/week/month/quarter/year
- Calendar view (drag to reschedule)
- Roadmap view (portfolio-level, by quarter, epic cards)

**Manday / Effort:**
- Estimate in manday + hour (configurable per project), confidence (H/M/L), PERT
- Actual: inline "log hours" on task (Phase 1); full timesheet Phase 2
- Capacity: per-resource manday/week, calendar-aware (Thai holidays preloaded), per-project allocation %
- Burn: planned vs actual manday per week, EV/PV/AC chart, ETC
- Auto-replan suggestion when actual > 120% of estimate

**Resource & calendar:**
- Working calendar (tenant + per-resource override): workdays, working hours, holidays, leave
- Skill matrix linked to Expert workspace expertise profile
- Resource heatmap

### 3.2 Role Workspaces (`workspace-svc` + `document-svc`)

Each role gets its own workspace with curated document types and templates:

| Role | Artifacts | Special features |
|---|---|---|
| **PM** | Project Charter, Status Report, Risk Register, Issue Log, Change Request, Stakeholder Register | RAID matrix, EVM dashboard, executive summary auto-gen (LLM) |
| **BA** | BRD, FRD, User Story, Use Case, Process Flow (BPMN), RTM | Story splitting helper, acceptance criteria template (Given/When/Then), requirement → test linkage |
| **SA** | SDD, ADR, ER Diagram, API Spec (OpenAPI), Sequence Diagram, Tech Stack Decision | Mermaid + PlantUML rendering, ADR voting, OpenAPI spec editor |
| **Expert** | Knowledge Article, Decision Log, Q&A, Lesson Learned, Expertise Profile | Semantic search (pgvector), expert recommendation engine, "ask the org" Q&A |

**Document engine (shared):**
Block-based editor (Tiptap/ProseMirror), version control (event-sourced via `change_event` table), comments, suggestions, e-signature, template registry, export PDF/DOCX.

### 3.3 Workflow Automation (`workflow-svc` Go + `workflow-runtime` Rust)

See Section 5 for detailed engine design.

Surface features:
- Visual designer (Workflow Studio): React Flow canvas, node palette, property panel, test runner
- Triggers: event, schedule, webhook, form, manual, record CRUD, field change
- Actions: HTTP, DB, email/notification, approval (human task), branch (if/switch), loop, parallel, sub-workflow, AI step (LLM with structured output)
- Approval engine: multi-level, conditional routing, delegation, escalation timer
- Durable execution: resumable, retry with backoff, idempotency key
- Observability: execution log, step-level timing, replay

### 3.4 Manufacturing (`mrp-engine` + `traceability-engine` Rust + `project-svc` extension)

- **BOM:** multi-level, effective date, alternates, phantom, BOM diff, versioning
- **Work Order:** routing (operations + work center), labor + machine, status (planned/released/in-progress/completed/closed), backflush
- **MRP (Rust):** net requirements calc, lead-time offset, lot sizing (LFL/EOQ/FOQ), pegging, action messages
- **Quality (IATF 16949):**
  - APQP phase gates
  - PPAP submission (level 1–5) + package builder
  - FMEA (PFMEA/DFMEA) with RPN
  - Control Plan
  - SPC (X-bar R, p-chart) — basic charts
- **Traceability (Rust):** lot/serial genealogy graph (Postgres for edges, ClickHouse for time-series events), forward/backward trace, recall scope calculation

### 3.5 Platform (`identity-svc` + `tenant-svc` + `notif-svc` + `integration-svc`)

- **Multi-tenant:** see Section 6
- **RBAC:** role + permission + resource scope (tenant/project/document), policy-as-code (Cedar or OPA)
- **Audit log:** ClickHouse, immutable, queryable, exportable
- **Notification:** in-app + email + webhook + Teams/Slack/LINE
- **Integration hub:** REST/GraphQL endpoints, signed webhooks in/out, prebuilt connectors (SAP B1, S/4 OData, Odoo, Jira, GitHub, Azure DevOps)
- **Reporting/BI:** dashboard builder (drag widget), data source via service API or read-replica SQL, schedule + export

---

## 4. UI Shell (Dynamics 365-style)

### 4.1 Layout anatomy

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [≡] [App Switcher ▾]  Manufacturing Hub        🔍 Search   🔔  ⚙  👤 Tenant ▾ │  ← Top bar (48px)
├────────────┬─────────────────────────────────────────────────────────────────┤
│            │ Home  >  Production  >  Work Orders  >  WO-2026-00421           │  ← Breadcrumb
│  Nav Pane  ├─────────────────────────────────────────────────────────────────┤
│  (240px)   │ [Save] [Save&Close] [+New] [Delete] [Workflow▾] [Share] [...]   │  ← Command bar
│            ├─────────────────────────────────────────────────────────────────┤
│            │ Header card  |  Tab strip  |  Form grid + Side pane             │
│            │ Subgrids (related lists)                                        │
└────────────┴─────────────────────────────────────────────────────────────────┘
```

### 4.2 Core UI primitives

1. **AppShell** — top bar, nav pane (collapsible/pinned), area switcher
2. **Nav Pane** — group → entity links + recently used + favorites + inline "+ New"
3. **Command Bar** — context-aware actions, overflow `…`, workflow trigger buttons
4. **List View / Grid** — virtualized table (TanStack Table), inline edit, column chooser, view selector (System/My/Saved), chip-based advanced filter, group, export
5. **Form** — sections + tabs + 2-column field grid, business rules engine (show/hide/require/lock by condition), header pin, footer summary
6. **Subgrid** — embedded related list inside form
7. **Quick Create** — slide-over panel for fast create without leaving context
8. **Side Pane** — activity feed, comments, related records, AI assistant
9. **Process Flow Bar** — horizontal stage indicator (Lead → Qualify → Develop → Close)
10. **Dashboard** — drag-resize grid (react-grid-layout); widgets = chart / list / iframe / KPI tile
11. **Notification Center** — bell dropdown + dedicated page
12. **Personalization** — user-saved form layout, list view, dashboard, theme

### 4.3 Navigation model
- **Apps** (top-level, switched via app switcher): "PM Hub", "Manufacturing Hub", "BA Workspace", "SA Workspace", "Expert Hub", "Workflow Studio", "Admin Center"
- **Areas → Groups → Subareas** within each app
- App definition stored in DB (`app_definition`) — editable through Admin UI without code deploy

### 4.4 Design tokens
- Color: primary `#0B5CFF`, warm-gray neutrals, teal/amber accents
- Typography: Inter (UI), JetBrains Mono (code/IDs)
- Density: compact / cozy / comfortable
- Theme: light / dark / high-contrast + per-tenant brand color
- Radius: `md = 6px` (sharp, Dynamics-like)
- Icons: Lucide + custom manufacturing set

### 4.5 Frontend architecture
- **Schema-driven rendering:** Form, View, Dashboard layouts are JSON in DB → React renders
- **Customization layer:** per-tenant overrides merge over base at render time (Dynamics Solution layering)
- **Custom fields:** EAV via `custom_field_definition` + JSONB value, GIN indexed
- **Accessibility:** WCAG 2.2 AA, keyboard-first nav (`Alt+...` shortcuts), screen reader labels, focus management

---

## 5. Workflow Engine

### 5.1 Architecture

```
Workflow Studio (Next.js, React Flow)
        │ REST (definition CRUD, deploy, run)
        ▼
workflow-svc (Go) — definition + RBAC + audit
        │ publish "workflow.deployed"
        ▼
workflow-runtime (Rust) — executor
        │ events: step.started/completed, instance.done
        ▼
NATS JetStream → notif-svc, audit (ClickHouse)
```

### 5.2 DSL (JSON, versioned)

Example:
```json
{
  "id": "wf_approval_change_request",
  "version": 7,
  "trigger": { "type": "record.created", "entity": "change_request" },
  "input_schema": { "$ref": "#/schemas/change_request" },
  "variables": { "approver_chain": [] },
  "steps": [
    { "id": "calc_chain", "type": "expression",
      "expr": "resolveApprovers(input.amount, input.project_id)",
      "out": "approver_chain" },
    { "id": "loop_approval", "type": "foreach",
      "items": "approver_chain", "as": "approver",
      "do": [
        { "id": "approve", "type": "human_task",
          "assignee": "{{approver.user_id}}",
          "form": "approval_form_v2",
          "sla": "P2D", "on_timeout": "escalate" },
        { "id": "branch", "type": "switch",
          "cases": [
            { "when": "approve.outcome == 'rejected'",
              "do": [{ "type": "end", "result": "rejected" }] }
          ] }
      ] },
    { "id": "apply", "type": "http",
      "method": "POST",
      "url": "internal://project-svc/change-requests/{{input.id}}/apply",
      "retry": { "max": 3, "backoff": "exponential" } },
    { "id": "notify", "type": "notification",
      "channel": ["in_app", "email"],
      "template": "cr_approved",
      "to": "{{input.requester_id}}" }
  ],
  "on_error": "compensate_and_notify_admin"
}
```

### 5.3 Node types (MVP)

| Category | Nodes |
|---|---|
| Control | start, end, switch, foreach, parallel, wait (duration/until), sub-workflow |
| Data | expression (sandboxed JS via `boa`/`rquickjs`), set-variable, transform |
| Integration | http, db-query, webhook-send |
| Built-in | send-email, send-notification, create-record, update-record, delete-record |
| Human | human-task (approval/form), assign-task |
| AI | llm-call (structured output via JSON schema), classify, summarize, extract |

### 5.4 Trigger types
`record.created`, `record.updated`, `record.deleted`, `field.changed`, `schedule (cron)`, `webhook (signed)`, `manual` (button on record/command bar), `event (any NATS subject)`, `form.submitted`

### 5.5 Designer UX
- Canvas: React Flow, auto-layout via dagre, pan/zoom, mini-map
- Node palette (left): grouped + search
- Property panel (right): schema-driven form, expression editor with scope-aware autocomplete
- Versioning: save = new draft; "Publish" promotes; running instances stay on their started version
- Test runner: sample input → step-by-step preview + variable values
- Run history: status, duration, filter; click → timeline + step details + replay

### 5.6 Execution semantics
- Each instance = row in `workflow_instance` (state JSON, cursor = current step id, version)
- State persisted before/after every step (atomic)
- Crash recovery: scan `running` instances without active lease on startup
- Idempotency: every side-effecting step has `idempotency_key`, skip on replay
- Long waits (e.g., `wait P30D`) = no compute; scheduler wakes at deadline
- Compensation: optional `compensate` block per step (saga)

### 5.7 PM ↔ Workflow integration
- Triggers: `task.created`, `task.status_changed`, `task.overdue`, `milestone.reached`
- Actions: `create_task`, `assign_task`, `split_task_from_template`
- Built-in workflows: auto-escalate overdue task, auto-rebaseline on scope change, daily standup digest

### 5.8 Performance targets
- 10k workflow instances running concurrently per runtime node
- p95 step transition < 100 ms (excluding external waits)
- Horizontal scale: add runtime nodes, partition by `tenant_id`

---

## 6. Data Model & Multi-tenancy

### 6.1 Tenancy tiers

| Tier | Isolation | Target |
|---|---|---|
| Shared | Same DB cluster, Postgres RLS (`tenant_id` on every row), `public` schema | SME / SI partners (D) |
| Schema-isolated | Same cluster, `tenant_<id>` schema | Mid-tier enterprise |
| Dedicated | Separate DB + namespace + S3 bucket + Redis | Tier-1 manufacturers (C) |

- Middleware sets `app.current_tenant` Postgres session var; RLS enforces (early drafts of this spec called the variable `app.tenant_id` — the canonical name across code, migrations, and policies is `app.current_tenant`)
- Tenant routing: subdomain (`acme.app.com`) or `X-Tenant-Id` header for dedicated
- Cross-tenant ops require `super_tenant` role + explicit audit

### 6.2 Core entities

**identity-svc:** `tenant`, `user`, `org_unit`, `role`, `permission`, `role_assignment`, `group`, `sso_config`, `api_key`, `session`

**project-svc:** `portfolio`, `program`, `project`, `workstream`, `task` (polymorphic), `task_dependency`, `sprint`, `board`, `board_column`, `baseline`, `baseline_task_snapshot`, `estimate`, `time_entry`, `working_calendar`, `holiday`, `resource_allocation`

**workspace-svc + document-svc:** `workspace`, `document`, `document_version`, `change_event` (append-only), `document_block`, `comment`, `suggestion`, `signature`, `template`, `document_link`, `requirement`, `architecture_decision`, `knowledge_article`, `knowledge_embedding` (pgvector)

**workflow:** `workflow_definition`, `workflow_version`, `trigger_binding`, `deployment`, `workflow_instance`, `step_execution`, `human_task`

**Manufacturing:** `item`, `uom`, `item_category`, `bom_header`, `bom_line`, `routing_header`, `routing_operation`, `work_center`, `work_center_capacity`, `work_order`, `work_order_operation`, `work_order_material`, `mrp_run`, `mrp_demand`, `mrp_supply`, `mrp_action_message`, `lot`, `serial`, `genealogy_edge`, `quality_apqp_phase`, `ppap_submission`, `ppap_element`, `fmea`, `fmea_failure_mode`, `control_plan`, `control_plan_characteristic`, `inspection`, `inspection_result`, `nonconformance`, `capa`

**Platform:** `audit_log` (ClickHouse), `notification`, `notification_channel_pref`, `app_definition`, `sitemap`, `view_definition`, `form_definition`, `integration_connection`, `webhook_subscription`

### 6.3 Cross-cutting patterns
- Soft delete (`deleted_at`), RLS filters out by default
- Optimistic concurrency (`version` int, update WHERE version = x)
- Outbox pattern: every state change writes to `outbox` → background publisher → NATS
- Event sourcing only for `document` and `workflow_instance`; rest is CRUD with audit
- CQRS-lite: materialized views / Redis for hot lists
- Time-series in ClickHouse: audit, SPC, traceability events, workflow history
- Search: Meilisearch indices per major entity, synced via outbox
- Vector: pgvector on `knowledge_article`, `requirement`, `task`

### 6.4 Customization storage
- `customization_layer`: per-tenant overrides of `app_definition` / `form_definition` / `view_definition` — render-time merge
- `custom_field_definition` + `custom_field_value` (EAV with JSONB, GIN-indexed)

### 6.5 Data sovereignty
- Dedicated deployments store data in customer VPC, encryption at rest (KMS), TLS 1.3
- PII column tagging → masking in non-prod, export policy
- Data residency: tenant config bound to region cluster

### 6.6 Migration
- `goose` for schema migration, run pre-deploy
- Backward-compatible only (expand → migrate data → contract)
- Per-tenant migration job for schema-isolated and dedicated tiers

---

## 7. Testing, CI/CD, Observability

### 7.1 Testing pyramid

| Layer | Tool | Target |
|---|---|---|
| Unit (Go) | `testing` + `testify` + `gomock` | ≥ 80% business logic |
| Unit (Rust) | `#[test]` + `proptest` | ≥ 80% |
| Unit (TS/React) | Vitest + RTL | ≥ 70% |
| Integration | testcontainers (PG, NATS, Redis) | every API, happy + error |
| Contract | Pact (consumer-driven) | every cross-service call |
| E2E | Playwright | critical journeys per persona |
| Workflow | Runtime replay (record → assert deterministic) | every node type + saga |
| Load | k6 | 10k workflow instances, 1k concurrent users |
| Security | gosec, cargo-audit, npm audit, OWASP ZAP, Semgrep | block on high/critical |
| Accessibility | axe-core in Playwright | WCAG 2.2 AA |

PR gate: unit + integration (changed services) + contract + a11y (frontend) + lint/format.

**TDD discipline:** test-first for MRP engine, workflow runtime, RBAC evaluator, EVM calc, traceability traversal — no exception.

### 7.2 CI/CD pipeline

```
PR opened
  ├─ lint + format (gofmt, clippy, biome)
  ├─ unit tests (parallel per service)
  ├─ build images
  ├─ integration tests (testcontainers)
  ├─ contract tests
  ├─ frontend: typecheck, vitest, build, a11y on storybook
  └─ security: gosec, cargo-audit, npm audit, Semgrep, Trivy (container scan)

Merge to main
  ├─ all above on main
  ├─ E2E (Playwright on ephemeral env via Helm + kind/k3d)
  ├─ load smoke (k6 short profile)
  ├─ publish images (signed via cosign, SBOM via syft)
  └─ deploy to staging (ArgoCD), run E2E + perf

Release tag
  ├─ promote to prod (ArgoCD)
  ├─ db migration (goose, pre-deploy hook, backward-compat only)
  ├─ canary 5% → 25% → 100% (Argo Rollouts)
  └─ post-deploy smoke + synthetic
```

Tooling: GitHub Actions (or Gitea Actions for on-prem), ArgoCD, Argo Rollouts, Helm, Kustomize overlay per tenant tier.

### 7.3 Observability

- **Logs:** structured JSON (zerolog Go, `tracing` Rust, pino TS) → Loki / OpenSearch; per-request `tenant_id`, `trace_id`, `user_id`
- **Metrics:** Prometheus + Grafana
  - RED per endpoint
  - Workflow: instances active, step latency, failure rate, queue depth
  - Manufacturing: MRP run duration, BOM explosion depth, traceability query latency
- **Traces:** OpenTelemetry → Tempo / Jaeger; cross-service + into workflow steps
- **Audit:** ClickHouse separate pipeline (write-only, signed, immutable retention per tenant)
- **Session replay:** opt-in PostHog or self-hosted OpenReplay

### 7.4 SLOs (production)
- API availability 99.9% rolling 30d
- API p95 latency < 300 ms (read), < 800 ms (write)
- Workflow step p95 < 100 ms (excluding human wait)
- MRP run < 60 s for 100k items
- Error budget burn alert at 2% / hour

### 7.5 Environments
- `dev` — docker-compose
- `ci` — ephemeral k3d per PR
- `staging` — prod-like, weekly anonymized data refresh
- `prod` — multi-region for shared; single-region per dedicated tenant
- `sandbox` — per-tenant copy-on-write for enterprise customers

### 7.6 Feature management
- Trunk-based, feature flags via Unleash (self-hosted), per-tenant rollout, kill switch
- Beta program: tenants opt in

### 7.7 Documentation as code
- ADR in repo (`docs/adr/NNNN-title.md`)
- OpenAPI generated from Go handlers (`huma`)
- Runbook per service (`docs/runbook/<service>.md`)
- Onboarding indexed by the product's own Knowledge module (dog-fooding)

---

## 8. Open Questions / Decisions Deferred

- **Deployment topology** — per-customer; not decided here.
- **Authoring language for Workflow expression sandbox** — `boa` vs `rquickjs` vs custom. Decide during runtime spike.
- **BPMN compatibility level** — MVP ships custom DSL; BPMN 2.0 import/export deferred to Phase 2.
- **Specific connector priorities** — SAP B1 vs S/4HANA OData first; pending sales input.
- **Vector model for `knowledge_embedding`** — pgvector requires choosing an embedding model (OpenAI vs Cohere vs self-hosted). Decide during Knowledge module build.

---

## 9. Out of Scope (Phase 1)

Resource capacity planning UI, full timesheet + approval, MRP-II / APS, Shop floor IoT, Inventory / Warehouse, Maintenance, Cost accounting, Financial integration, Real-time collaborative editing (CRDT), Mobile native apps.
