# Plan #17 — Accounting Hub, HR Hub & Module Dashboards

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate Accounting and HR to first-class apps, add real KPI dashboards to MFG/PM/Accounting/HR home pages, and add missing Positions page.

**Architecture:** New `accounting` and `hr` app definitions in mockApps. New shell layouts at `app/(shell)/accounting/` and `app/(shell)/hr/`. Home pages fetch real data from accounting-svc (8095) and hr-svc (8096). MFG and PM home pages extended with new KPI tiles.

**Tech Stack:** Next.js 15, React 19, Tailwind 4, TanStack Query, existing KpiWidget/ChartWidget components, accounting-svc (8095), hr-svc (8096), project-svc (8083), mfg-svc (8085)

---

## Status: COMPLETED (2026-05-26)

All tasks implemented and committed:

- `fff7eff feat(plan17): Accounting Hub + HR Hub as first-class apps`
- `31e2f85 feat(plan17): enhance MFG and PM home dashboards with real KPIs`

### What was built

**Accounting Hub** (`/accounting/*`):
- `app/(shell)/accounting/layout.tsx` — uses `useAppDefinition("accounting")`
- `app/(shell)/accounting/home/page.tsx` — KPI dashboard (Total Accounts, JE Draft, JE Posted, Invoices Unpaid)
- `app/(shell)/accounting/accounts/page.tsx` — Chart of Accounts CRUD
- `app/(shell)/accounting/journal-entries/page.tsx` — JE list + detail split-pane
- `app/(shell)/accounting/invoices/page.tsx` — AR/AP invoice management
- `app/(shell)/accounting/reports/page.tsx` — Accounts grouped by type

**HR Hub** (`/hr/*`):
- `app/(shell)/hr/layout.tsx` — uses `useAppDefinition("hr")`
- `app/(shell)/hr/home/page.tsx` — KPI dashboard (Total Employees, Departments, Positions, Active)
- `app/(shell)/hr/departments/page.tsx` — Departments CRUD
- `app/(shell)/hr/employees/page.tsx` — Employee management
- `app/(shell)/hr/positions/page.tsx` — NEW: Positions CRUD page

**Dashboard improvements:**
- MFG home: added Total Items, Lots in Quarantine, Active Suppliers KPIs
- PM home: added Active Projects (server-side), Blocked Tasks, Completion % KPIs

**Navigation:**
- Removed Accounting and HR groups from PM Hub Admin (they have their own apps now)
- Added Accounting Hub and HR Hub to mockApps (appear in App Switcher)
