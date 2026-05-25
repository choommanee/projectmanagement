# System Analysis & Development Roadmap Design

**Date:** 2026-05-25  
**Status:** Approved  
**Authors:** BA Agent + SA Agent  
**Benchmark systems:** Jira (PM/Agile), Microsoft Dynamics 365 (ERP/PM), Odoo 17 (Open ERP)  
**Scope:** Comprehensive gap analysis covering PM, Manufacturing, and Platform — 3-phase roadmap (6–12 months)

---

## 1. Current System Baseline

### 1.1 What Is Built (Phase 1 ~85% complete)

**Go Services (all functional):**

| Service | Port | Status |
|---------|------|--------|
| identity-svc | 8082 | ✅ JWT/JWKS, user CRUD, policy.reload |
| tenant-svc | 8081 | ✅ Multi-tenant onboarding, RLS |
| project-svc | 8083 | ✅ Projects, Tasks, Sprints, Milestones, Workflows |
| document-svc | 8084 | ✅ Block editor, versioning, templates, ADR/RTM/User Story metadata |
| mfg-svc | 8085 | ✅ BOM, Work Orders, MRP trigger, Quality (APQP/PPAP/FMEA/SPC/NCR) |
| quality-svc | 8087 | ✅ Control plans, inspections, traceability |
| workflow-svc | 8090 | ✅ Workflow DSL, human task, HTTP/branch/parallel nodes |
| notification-svc | 8093 | ✅ In-app, email, Teams/Slack/LINE |
| audit-svc | 8089 | ✅ Immutable audit log, ClickHouse + PG dual-write |
| reports-svc | 8092 | ✅ API-backed reports (no UI builder yet) |

**Rust Engines:**

| Engine | Status |
|--------|--------|
| mrp-engine | ✅ Net requirements, lot sizing, pegging, action messages |
| traceability-engine | ✅ Lot/serial genealogy, forward/backward trace, recall scope |
| workflow-runtime | ✅ Durable execution, retry, idempotency |

**Frontend (Next.js 15):**
- PM Hub: projects, tasks, sprints (burndown), workflows, reports, BA/SA workspaces, audit, inbox — 11 pages
- Manufacturing Hub: BOM, Work Orders, MRP, APQP, PPAP, FMEA, Control Plans, NCRs, Traceability, Work Centers, Items, UOMs — 14 pages
- Components: GanttChart, BurndownChart, BomTree, DocEditor (Mermaid), WorkspaceShell (ADR/RTM/User Story panels), UserPicker, NotificationCenter

**Cedar Authorization:** Full action × resource matrix in `docs/adr/0002-cedar-actions.md`, policy-as-code in `libs/policy/bundle.cedar`.

---

## 2. BA Gap Analysis

### 2.1 Rating Legend
- ✅ **Implemented** — production-ready feature
- 🟡 **Partial** — exists but incomplete or UI-only / backend-only
- ❌ **Missing** — not built
- 🔵 **Planned** — in spec, not yet implemented

### 2.2 Domain 1 — PM & Agile (vs Jira + Dynamics 365 Project Operations)

| Feature | Our System | Jira | Dynamics | Gap Severity |
|---------|-----------|------|----------|-------------|
| Task hierarchy (Epic→Story→Task→Subtask) | 🟡 Partial (type field, no visual hierarchy nav) | ✅ | ✅ | High |
| **Product Backlog view** (drag-to-prioritize, filter by Epic) | ❌ Missing | ✅ | ✅ | **Critical** |
| Sprint board (Kanban) | ✅ | ✅ | ✅ | — |
| Sprint planning (add/remove stories) | 🟡 UI exists, no drag-to-sprint | ✅ | ✅ | High |
| Burndown chart | ✅ | ✅ | ✅ | — |
| **Velocity chart** | ❌ Missing | ✅ | ❌ | Medium |
| **Cumulative Flow Diagram (CFD)** | ❌ Missing | ✅ | ❌ | Medium |
| **Control chart** (cycle time) | ❌ Missing | ✅ | ❌ | Medium |
| Gantt / Timeline | ✅ | 🟡 (Premium) | ✅ | — |
| **Roadmap** (cross-project, quarterly) | ❌ Missing | ✅ | ✅ | **Critical** |
| **Time tracking + Worklog** | ❌ Missing | ✅ | ✅ | **Critical** |
| Issue linking (blocks / duplicates / relates to) | 🟡 Dependency FS/SS/FF only | ✅ | ✅ | High |
| **Automation rules** (no-code trigger/action) | ❌ Missing (workflow-svc has engine, no UI) | ✅ | ✅ | **Critical** |
| Custom fields | 🔵 DB layer (EAV) exists, no UI | ✅ | ✅ | **Critical** |
| Permissions (project-role, issue-level) | ✅ Cedar ABAC | ✅ | ✅ | — |
| **GitHub / GitLab commit → issue link** | ❌ Missing | ✅ | ❌ | High |
| **Advanced filter / JQL-equivalent** | ❌ Missing | ✅ | ✅ | High |
| **Components & Versions** (release tracking) | ❌ Missing | ✅ | ❌ | Medium |
| Notification / @mention | ✅ | ✅ | ✅ | — |
| Audit log | ✅ | ✅ | ✅ | — |
| Export (CSV/Excel) | 🟡 Reports-svc API, no UI button | ✅ | ✅ | Medium |
| API (REST) | ✅ | ✅ | ✅ | — |

**PM Domain Summary:** 7 Critical gaps, 5 High, 3 Medium

---

### 2.3 Domain 2 — Manufacturing & ERP (vs Dynamics 365 Manufacturing + Odoo 17)

| Feature | Our System | Dynamics 365 | Odoo 17 | Gap Severity |
|---------|-----------|--------------|---------|-------------|
| BOM (multi-level, versioning) | ✅ | ✅ | ✅ | — |
| Work Order (routing, operations) | ✅ | ✅ | ✅ | — |
| MRP (net requirements, lot sizing) | ✅ Rust engine | ✅ | ✅ | — |
| Pegging / Action messages | ✅ | ✅ | 🟡 | — |
| Quality (APQP/PPAP/FMEA/SPC/NCR) | ✅ | ✅ | 🟡 | — |
| Traceability (lot/serial genealogy) | ✅ Rust engine | ✅ | 🟡 | — |
| **Inventory Management** (stock, transactions, locations) | ❌ Missing | ✅ | ✅ | **Critical** |
| **Purchase Order / Procurement** | ❌ Missing | ✅ | ✅ | **Critical** |
| **Goods Receipt / 3-way match** | ❌ Missing | ✅ | ✅ | **Critical** |
| **Warehouse Management** (put-away, pick) | ❌ Missing | ✅ | ✅ | High |
| **Engineering Change Orders (ECO)** | ❌ Missing | ✅ | ✅ (PLM) | High |
| **Product Lifecycle Management (PLM)** | ❌ Missing | ✅ | ✅ | High |
| **Available-to-Promise (ATP)** | ❌ Missing | ✅ | 🟡 | High |
| **Plant Maintenance** (corrective/preventive) | ❌ Missing | ✅ | ✅ | High |
| **Cost Accounting** (standard cost, WO cost, variance) | ❌ Missing | ✅ | ✅ | High |
| **Barcode / IoT shop floor** | ❌ Missing | ✅ | ✅ | Medium |
| **Capacity Planning** (resource leveling, load) | ❌ Missing | ✅ | 🟡 | High |
| Work Center management | ✅ | ✅ | ✅ | — |
| CAPA management | ✅ (NCR→CAPA) | ✅ | 🟡 | — |
| Scrap / Rework tracking | 🟡 NCR basis | ✅ | ✅ | Medium |
| **Demand Forecasting** | ❌ Missing | ✅ | ✅ | Low (Phase 4) |

**MFG Domain Summary:** 3 Critical gaps (Inventory/PO/GR — foundational), 7 High, 2 Medium

---

### 2.4 Domain 3 — Platform & Cross-cutting (vs Dynamics 365 Platform + Odoo)

| Feature | Our System | Dynamics 365 | Odoo 17 | Gap Severity |
|---------|-----------|--------------|---------|-------------|
| Multi-tenant RLS | ✅ | ✅ | ✅ | — |
| Cedar ABAC | ✅ | ✅ | ❌ | — |
| **Custom Fields UI** (per-tenant configuration) | ❌ Missing (DB layer ✅) | ✅ | ✅ | **Critical** |
| **Reports / BI Builder** (drag-widget dashboard) | ❌ Missing (reports-svc API ✅) | ✅ | ✅ | **Critical** |
| **Workflow Studio UI** (visual designer) | ❌ Missing (backend ✅) | ✅ | ✅ | **Critical** |
| Document management (block editor, versioning) | ✅ | ✅ | 🟡 | — |
| Notification (in-app, email, Teams/Slack/LINE) | ✅ | ✅ | ✅ | — |
| **Integration hub** (SAP/Odoo/Jira connectors) | 🔵 Planned, not built | ✅ | ✅ | **Critical** |
| Webhook in/out (HMAC signed) | 🔵 Planned | ✅ | ✅ | High |
| **Mobile app / PWA** | ❌ Missing | ✅ | ✅ | High |
| **SAML / OIDC SSO** | 🔵 In spec, not built | ✅ | ✅ | High |
| **WebAuthn / Passkey** | 🔵 In spec, not built | ✅ | ❌ | Medium |
| RBAC (role + permission) | ✅ | ✅ | ✅ | — |
| Audit log (immutable, ClickHouse) | ✅ | ✅ | ✅ | — |
| **Tenant Admin UI** | ❌ Missing | ✅ | ✅ | High |
| **AI features** (auto-assign, summarize, anomaly) | ❌ Missing | ✅ (Copilot) | 🟡 | Medium |
| **Advanced search** (global, full-text + semantic) | 🔵 Meilisearch + pgvector planned | ✅ | ✅ | High |
| API (REST) | ✅ | ✅ | ✅ | — |
| **API marketplace / developer portal** | ❌ Missing | ✅ | ❌ | Low |

**Platform Domain Summary:** 4 Critical gaps, 6 High, 3 Medium

---

## 3. SA Architecture Assessment

### 3.1 T1 — Scalability

| Gap | Current State | Target | Priority |
|-----|--------------|--------|----------|
| WebSocket hub single-process | Go gateway, no horizontal scale | Redis Pub/Sub fan-out for multi-pod WebSocket | High |
| Meilisearch not wired | Configured but not connected to project/document indexing | Wire index on document.create/update NATS event | High |
| ClickHouse primary write | Audit still dual-writes PG first | ClickHouse as primary, PG as fallback only | Medium |
| Read replicas | None | PG streaming replica for reports-svc queries | Medium |
| NATS consumer groups | Single consumer per stream | Consumer group with competing consumers for workflow events | Medium |

### 3.2 T2 — Integration Hub

| Gap | Current State | Target | Priority |
|-----|--------------|--------|----------|
| GitHub/GitLab connector | Not built | Webhook receiver → project-svc issue link | **Critical** |
| Odoo connector | Not built | OData/REST sync for MFG master data | High |
| SAP S/4 OData connector | Not built | S/4HANA OData v4 adapter | Phase 4 |
| HMAC webhook signing | Spec exists, not implemented | Signed outbound webhooks with retry | High |
| Integration event log | Not built | Per-connector sync log, error surface | High |

### 3.3 T3 — Observability

| Gap | Current State | Target | Priority |
|-----|--------------|--------|----------|
| OTEL tracing wire-up | `libs/go/otel` exists, only partial service adoption | All services instrument spans | **Critical** |
| Prometheus `/metrics` | No metrics endpoints | `promhttp.Handler()` in every service | **Critical** |
| Trace-ID propagation | Logger has trace field, not propagated cross-service | `X-Trace-ID` header chain through BFF | High |
| Grafana + Jaeger stack | docker-compose stub | Working observability compose profile | High |

### 3.4 T4 — Security Hardening

| Gap | Current State | Target | Priority |
|-----|--------------|--------|----------|
| SAML/OIDC federation | identity-svc spec mentions it, not built | SAML 2.0 SP + OIDC RP in identity-svc | High |
| WebAuthn / Passkey | In original spec, not built | WebAuthn registration/auth in identity-svc | Medium |
| Rate limiting | No middleware | chi middleware: per-IP + per-tenant rate limiter | High |
| JWT rotation auto-trigger | Manual admin endpoint only | JWT_ROTATION_INTERVAL goroutine | Low |

### 3.5 T5 — Workflow Studio UI

| Gap | Current State | Target | Priority |
|-----|--------------|--------|----------|
| Visual designer (React Flow canvas) | workflow-svc backend complete, zero UI | React Flow canvas + node palette + property panel | **Critical** |
| Trigger configurator | None | UI for event/schedule/webhook/form triggers | **Critical** |
| Execution log viewer | None | Step-level timing, replay, error drill-down | High |
| AI step (LLM action node) | Not built | Anthropic Claude API integration as workflow node | High |

### 3.6 T6 — Mobile & Accessibility

| Gap | Current State | Target | Priority |
|-----|--------------|--------|----------|
| Mobile-responsive breakpoints | Desktop-first shell | Tailwind responsive variants, mobile nav | High |
| PWA manifest + service worker | Not present | next-pwa, offline capability for read views | Medium |
| WCAG 2.2 AA audit | Not formally done | Automated axe-core scan + manual keyboard audit | Medium |

---

## 4. Competitive Maturity Summary

| Domain | Our Score | Jira | Dynamics 365 | Odoo 17 |
|--------|-----------|------|--------------|---------|
| PM Core | 3/5 | 5/5 | 4/5 | 3/5 |
| Agile / Scrum | 3/5 | 5/5 | 3/5 | 2/5 |
| Manufacturing | 3/5 | ❌ | 4/5 | 4/5 |
| Quality (IATF/APQP) | 4/5 | ❌ | 3/5 | 3/5 |
| Workflow Automation | 2/5 (engine only) | 4/5 | 5/5 | 3/5 |
| BA/SA Workspace | 4/5 | 2/5 | 2/5 | 1/5 |
| Platform / Integration | 2/5 | 4/5 | 5/5 | 4/5 |
| Observability | 1/5 | N/A | N/A | N/A |

**Unique competitive advantage:** BA/SA Workspace (ADR voting, RTM, Mermaid, acceptance criteria) + Quality (APQP/PPAP/FMEA out-of-the-box) + Rust-engine MRP/Traceability — no direct competitor in this combination.

---

## 5. 3-Phase Development Roadmap

### Phase 2 — Critical Gap Closure (Month 1–3)
**Theme:** Close the gaps that block customer acquisition.

| ID | Feature | Domain | Benchmark parity | Dev Plan # |
|----|---------|--------|-----------------|-----------|
| P2-1 | **Workflow Studio UI** — React Flow canvas, node palette, trigger config, execution log | Platform | Dynamics, Odoo | Plan #10 |
| P2-2 | **Backlog view** — product backlog drag-to-prioritize, Epic/Story filter, quick create | PM | Jira | Plan #10 |
| P2-3 | **Inventory Management** — items, stock transactions, lot control, stock valuation | MFG | Odoo | Plan #11 |
| P2-4 | **Time Tracking + Worklog** — inline log hours, worklog history tab, reported vs estimate | PM | Jira | Plan #11 |
| P2-5 | **Reports/BI Builder UI** — drag-widget dashboard, KPI tiles, chart widgets (reports-svc exists) | Platform | Dynamics | Plan #12 |
| P2-6 | **OTEL + Prometheus** — tracing wire all services, metrics endpoints, Grafana compose profile | Platform | Production req | Plan #12 |
| P2-7 | **Custom Fields UI** — per-tenant EAV field config, field types (text/number/date/dropdown/user) | Platform | Dynamics, Jira | Plan #13 |
| P2-8 | **Integration Hub foundation** — webhook in/out HMAC, GitHub/GitLab issue link, connector framework | Platform | Jira | Plan #13 |

**Phase 2 output:** Platform competitive with Jira Software + Odoo Manufacturing basic, with unique BA/SA + Quality advantages.

---

### Phase 3 — Jira + Odoo Mid-tier Parity (Month 3–6)
**Theme:** Win SME manufacturer market.

| ID | Feature | Domain | Benchmark parity |
|----|---------|--------|-----------------|
| P3-1 | **Automation Rules** — no-code trigger/action builder (Jira Automation equivalent) | PM | Jira |
| P3-2 | **Advanced Agile Charts** — velocity, CFD, control chart, EVM dashboard | PM | Jira |
| P3-3 | **Engineering Change Orders (ECO)** — BOM change proposal, review, approval workflow | MFG | Odoo PLM |
| P3-4 | **Purchase / Procurement** — PO, GR, 3-way match, supplier management | MFG | Odoo |
| P3-5 | **Capacity Planning UI** — resource heatmap, availability calendar, load balancing | PM/MFG | Dynamics |
| P3-6 | **SAML/OIDC SSO** — enterprise identity federation (identity-svc already spec'd) | Platform | All |
| P3-7 | **Mobile PWA** — responsive breakpoints, PWA manifest, offline read | Platform | All |
| P3-8 | **AI Step in Workflow** — LLM action node (Claude API), structured output, prompt template | Platform | Dynamics Copilot |
| P3-9 | **Global Search** — Meilisearch wire-up for project/document/task, semantic (pgvector) | Platform | All |
| P3-10 | **Tenant Admin UI** — user management, role assignment, branding, custom fields admin | Platform | Dynamics |

---

### Phase 4 — Dynamics 365 / SAP Enterprise Tier (Month 6–12)
**Theme:** Tier-1 manufacturer ready.

| ID | Feature | Domain | Benchmark parity |
|----|---------|--------|-----------------|
| P4-1 | **Plant Maintenance** — preventive/corrective WO, maintenance plans, asset register | MFG | SAP PM |
| P4-2 | **Cost Accounting** — standard cost, WO cost capture, variance analysis, cost rollup | MFG | SAP CO / Dynamics |
| P4-3 | **SAP S/4 OData connector** — master data sync (material, vendor, customer), document flow | Platform | — |
| P4-4 | **Odoo Manufacturing connector** — BOM, MO, inventory sync | Platform | — |
| P4-5 | **Real-time Collaboration** — CRDT document co-editing (Yjs or Liveblocks) | Platform | Google Workspace |
| P4-6 | **IoT / Shop Floor** — barcode scan API, RFID event receiver, machine OPC-UA bridge | MFG | SAP MES |
| P4-7 | **Supply Chain Planning** — demand forecast (statistical), MPS, supplier portal | MFG | SAP SCM |
| P4-8 | **AI Intelligence Layer** — anomaly detection (SPC alerts), auto-assign (ML model), predictive ETA | Platform | Dynamics Copilot |
| P4-9 | **Financial Integration** — AP/AR GL sync, cost center mapping, multi-currency | MFG | SAP FI |

---

## 6. UI Quality Mandate (Dynamics 365 Enterprise Standard)

All Phase 2+ work must meet the following UX bar — **not just functional, but production-polished**:

### 6.1 Visual Language (Dynamics 365 Style)
- **Command Bar** — every list/form page has a sticky command bar with primary actions (Save, New, Delete, Workflow▾), overflow `...`
- **Form layout** — 2-column field grid, collapsible sections, header card with record title + status badge, tab strip for related data
- **Process Flow Bar** — horizontal stage indicator for entities with lifecycle (Work Order: Planned → Released → In-Progress → Completed)
- **Subgrid** — embedded related-record list inside form (e.g., Task → Subtasks subgrid, WO → Operations subgrid)
- **Side Pane** — right-side activity feed: comments, history, related documents, AI assistant panel
- **Quick Create panel** — slide-over (not full page) for fast creation without losing context
- **Breadcrumb** — always visible: `Home > Module > Entity > Record Name`

### 6.2 Design Token Enforcement
- Colors exclusively from `packages/design-tokens/` — primary `#0B5CFF`, warm-gray neutrals, teal accent
- Typography: `Inter` for UI text, `JetBrains Mono` for IDs/metrics/code
- Density: compact/cozy/comfortable toggle (default cozy)
- Radius: `6px` — sharp, instrument-panel feel
- Shadows: subtle `0 1px 3px` card elevation, no heavy drop shadows
- Icons: Lucide set + custom manufacturing icons — no emoji in UI

### 6.3 Interaction Polish
- Loading states: skeleton screens (not spinners) for list/form initial load
- Optimistic updates: local state update before API confirm, rollback on error with toast
- Empty states: actionable — "No work orders yet. [+ Create Work Order]"
- Error states: inline validation (red border + message below field), not alert dialogs
- Keyboard navigation: Tab order logical, `Alt+N` = New, `Alt+S` = Save, `Esc` = cancel/close panel
- Responsive: desktop-first but mobile-usable at ≥768px for key flows (view lists, read forms)

### 6.4 New Page Checklist (every Phase 2+ page must pass)
- [ ] Command bar with context-appropriate actions
- [ ] Breadcrumb navigation
- [ ] Loading skeleton
- [ ] Empty state with CTA
- [ ] Mobile ≥768px layout
- [ ] WCAG: all interactive elements have aria-label or visible label
- [ ] Design tokens only — no hardcoded hex/rem/px outside tokens

---

## 8. Implementation Approach

### Dev Agent Dispatch per Phase 2 Plan

Phase 2 groups into **4 implementation plans** (Plans #10–#13), each executable by the dev agent team:

| Plan | Features | Primary Agents |
|------|---------|---------------|
| **Plan #10** | Workflow Studio UI (P2-1) + Backlog view (P2-2) | `frontend-ui-engineer` |
| **Plan #11** | Inventory Management (P2-3) + Time Tracking (P2-4) | `go-service-engineer` + `db-migration-steward` + `frontend-ui-engineer` |
| **Plan #12** | BI Builder UI (P2-5) + OTEL/Prometheus (P2-6) | `frontend-ui-engineer` + `devops-infra` + `go-service-engineer` |
| **Plan #13** | Custom Fields UI (P2-7) + Integration Hub (P2-8) | `go-service-engineer` + `frontend-ui-engineer` |

### Dependencies
- P2-1 (Workflow Studio) depends on: workflow-svc API (✅ done), workflow-runtime (✅ done)
- P2-3 (Inventory) requires: new `inventory-svc` or extend `mfg-svc`, new DB migrations
- P2-5 (BI Builder) depends on: reports-svc REST API (✅ done)
- P2-7 (Custom Fields UI) depends on: EAV schema in `custom_field_definition` table (needs migration verification)
- P2-8 (Integration Hub) requires: new `integration-svc` framework, HMAC signing middleware

### Conventions (carry forward from Phase 1)
- Every new service: follows `services/_template/` shape (cmd/server, internal/domain/store/service/api)
- Every new table: `tenant_id uuid NOT NULL` + RLS + `(tenant_id, ...)` composite index
- Every new endpoint: Cedar action in ADR 0002 + `permit` in `libs/policy/bundle.cedar`
- Frontend: no hardcoded colors/spacing — `packages/design-tokens/` only
- Tests: real Postgres on `:5432`, no DB mocks
- Migrations: `tools/scripts/migrate.sh`, Goose format, both Up + Down required

---

## 9. Deferred Items (Out of Phase 2 scope)

- Full timesheet / HR leave integration → Phase 3+
- ATP (available-to-promise) → Phase 3
- WebAuthn / Passkey → Phase 3
- CRDT real-time collaboration → Phase 4
- Cost Accounting → Phase 4
- Plant Maintenance → Phase 4
- IoT / Shop Floor → Phase 4
- Financial integration (AP/AR/GL) → Phase 4
- API marketplace / developer portal → Phase 4+
- Demand forecasting ML → Phase 4+
