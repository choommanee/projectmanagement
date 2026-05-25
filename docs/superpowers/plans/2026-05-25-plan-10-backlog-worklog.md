# Plan #10 — Product Backlog + Time Worklog + Velocity Chart

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a product backlog page with drag-to-prioritize, time worklog for tasks, and velocity chart on sprint detail.

**Architecture:** Backlog is a new frontend page over existing `GET /tasks` endpoint sorted by `sort_order`. Worklog is a new `task_worklog` table in project-svc with CRUD endpoints. VelocityChart is a pure SVG component that aggregates `actualMd` per sprint. Dynamics 365 UI quality mandate applies to every new page (command bar, breadcrumb, skeleton, empty state).

**Tech Stack:** Next.js 15 App Router, TanStack Query, @dnd-kit/core for drag-drop, Go chi, pgx, Goose migration.

---

## File Map

```
New (Migration):
  infra/migrations/project/00004_worklog.sql

New / Modified (Go — project-svc):
  services/project-svc/internal/domain/types.go          add WorklogEntry type
  services/project-svc/internal/store/worklog_store.go   new file — List / Create / Delete
  services/project-svc/internal/api/handlers.go          add listWorklogs / createWorklog / deleteWorklog + patchTaskOrder handler

New (Frontend proxy):
  apps/web/app/api/tasks/[id]/worklog/route.ts            GET + POST proxy → project-svc

New (Frontend lib):
  apps/web/src/lib/api/worklog.ts                         listWorklogs / createWorklog / deleteWorklog

New (Frontend components):
  apps/web/src/components/WorklogPanel.tsx                Log-hours panel used inside TaskSheet
  apps/web/src/components/VelocityChart.tsx               SVG velocity chart (planned vs actual mandays per sprint)

New (Frontend pages):
  apps/web/app/(shell)/pm/backlog/page.tsx                Product backlog — drag-to-prioritize list

Modified (Frontend):
  apps/web/src/components/TaskSheet.tsx                   add "Time" tab → WorklogPanel
  apps/web/app/(shell)/pm/sprints/[id]/page.tsx           add "Velocity" tab → VelocityChart
  apps/web/src/lib/mock/apps.ts                           add Backlog nav entry under PM Hub
```

---

### Task A — Worklog migration

**Files:**
- Create: `infra/migrations/project/00004_worklog.sql`

- [ ] **Step 1: Write migration**

```sql
-- +goose Up
CREATE TABLE IF NOT EXISTS task_worklog (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  task_id     UUID NOT NULL REFERENCES task(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  logged_md   NUMERIC(8,2) NOT NULL CHECK (logged_md > 0),
  work_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ENABLE ROW LEVEL SECURITY ON task_worklog;
ALTER TABLE task_worklog FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON task_worklog
  USING (tenant_id = current_tenant_uuid());

CREATE INDEX ix_worklog_task   ON task_worklog (tenant_id, task_id);
CREATE INDEX ix_worklog_user   ON task_worklog (tenant_id, user_id);

-- +goose Down
DROP TABLE IF EXISTS task_worklog;
```

- [ ] **Step 2: Run migration**

```bash
tools/scripts/migrate.sh up project
```

Expected: `goose: successfully migrated database to version 4`

- [ ] **Step 3: Commit**

```bash
git add infra/migrations/project/00004_worklog.sql
git commit -m "feat(project): add task_worklog table (Plan #10 Task A)"
```

---

### Task B — WorklogEntry domain type + store

**Files:**
- Modify: `services/project-svc/internal/domain/types.go`
- Create: `services/project-svc/internal/store/worklog_store.go`

- [ ] **Step 1: Add WorklogEntry to domain types**

In `services/project-svc/internal/domain/types.go`, after the last type definition, add:

```go
type WorklogEntry struct {
	ID        uuid.UUID
	TenantID  uuid.UUID
	TaskID    uuid.UUID
	UserID    uuid.UUID
	LoggedMd  float64
	WorkDate  time.Time
	Note      string
	CreatedAt time.Time
}

type CreateWorklogParams struct {
	TaskID   uuid.UUID
	UserID   uuid.UUID
	LoggedMd float64
	WorkDate time.Time
	Note     string
}
```

- [ ] **Step 2: Create worklog store**

Create `services/project-svc/internal/store/worklog_store.go`:

```go
package store

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	libdb "github.com/your-org/pm-platform/libs/go/db"

	"project-svc/internal/domain"
)

type WorklogStore struct{ pool *pgxpool.Pool }

func NewWorklogStore(pool *pgxpool.Pool) *WorklogStore { return &WorklogStore{pool: pool} }

func (s *WorklogStore) List(ctx context.Context, tenantID, taskID uuid.UUID) ([]domain.WorklogEntry, error) {
	ctx = libdb.WithTenant(ctx, tenantID)
	rows, err := s.pool.Query(ctx,
		`SELECT id, tenant_id, task_id, user_id, logged_md, work_date, note, created_at
		 FROM task_worklog WHERE task_id = $1 ORDER BY work_date DESC, created_at DESC`,
		taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.WorklogEntry
	for rows.Next() {
		var e domain.WorklogEntry
		if err := rows.Scan(&e.ID, &e.TenantID, &e.TaskID, &e.UserID,
			&e.LoggedMd, &e.WorkDate, &e.Note, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *WorklogStore) Create(ctx context.Context, tenantID uuid.UUID, p domain.CreateWorklogParams) (domain.WorklogEntry, error) {
	ctx = libdb.WithTenant(ctx, tenantID)
	var e domain.WorklogEntry
	err := s.pool.QueryRow(ctx,
		`INSERT INTO task_worklog (tenant_id, task_id, user_id, logged_md, work_date, note)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 RETURNING id, tenant_id, task_id, user_id, logged_md, work_date, note, created_at`,
		tenantID, p.TaskID, p.UserID, p.LoggedMd, p.WorkDate, p.Note,
	).Scan(&e.ID, &e.TenantID, &e.TaskID, &e.UserID, &e.LoggedMd, &e.WorkDate, &e.Note, &e.CreatedAt)
	return e, err
}

func (s *WorklogStore) Delete(ctx context.Context, tenantID, id uuid.UUID) error {
	ctx = libdb.WithTenant(ctx, tenantID)
	_, err := s.pool.Exec(ctx,
		`DELETE FROM task_worklog WHERE id = $1`, id)
	return err
}
```

- [ ] **Step 3: Wire WorklogStore into service struct**

In `services/project-svc/internal/service/service.go` (or wherever the main Service struct is defined), add:

```go
Worklog *store.WorklogStore
```

In `cmd/server/main.go`, after `NewWorklogStore` is available, wire it:

```go
svc.Worklog = store.NewWorklogStore(pool)
```

- [ ] **Step 4: Run tests to verify no regressions**

```bash
cd services/project-svc && go test ./...
```

Expected: all existing tests pass (worklog store has no tests yet — covered in Task C).

- [ ] **Step 5: Commit**

```bash
git add services/project-svc/
git commit -m "feat(project-svc): WorklogEntry domain + store (Plan #10 Task B)"
```

---

### Task C — Worklog API handlers + tests

**Files:**
- Modify: `services/project-svc/internal/api/handlers.go`

- [ ] **Step 1: Write handler tests first**

Add to `services/project-svc/internal/api/handlers_test.go`:

```go
func TestListWorklogs(t *testing.T) {
	// seed a task, call POST /tasks/{id}/worklogs, then GET /tasks/{id}/worklogs
	// assert 200 and items array contains the entry
}

func TestCreateWorklog_InvalidLoggedMd(t *testing.T) {
	// POST /tasks/{id}/worklogs with logged_md = -1
	// assert 400
}
```

- [ ] **Step 2: Run tests to see them fail**

```bash
cd services/project-svc && go test -run TestListWorklogs ./internal/api/... -v
```

Expected: FAIL — handlers don't exist yet

- [ ] **Step 3: Add worklog handlers**

In `services/project-svc/internal/api/handlers.go`, add after the `deleteTask` handler:

```go
// GET /tasks/{id}/worklogs
func listWorklogs(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid := tenantID(r)
		taskID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			http.Error(w, "invalid task id", http.StatusBadRequest)
			return
		}
		entries, err := svc.Worklog.List(r.Context(), tid, taskID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if entries == nil {
			entries = []domain.WorklogEntry{}
		}
		writeJSON(w, 200, map[string]any{"items": entries, "total": len(entries)})
	}
}

// POST /tasks/{id}/worklogs
func createWorklog(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid := tenantID(r)
		taskID, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			http.Error(w, "invalid task id", http.StatusBadRequest)
			return
		}
		var req struct {
			UserID   string  `json:"user_id"`
			LoggedMd float64 `json:"logged_md"`
			WorkDate string  `json:"work_date"`
			Note     string  `json:"note"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.LoggedMd <= 0 {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		userID, err := uuid.Parse(req.UserID)
		if err != nil {
			http.Error(w, "invalid user_id", http.StatusBadRequest)
			return
		}
		workDate := time.Now()
		if req.WorkDate != "" {
			workDate, err = time.Parse("2006-01-02", req.WorkDate)
			if err != nil {
				http.Error(w, "invalid work_date, expected YYYY-MM-DD", http.StatusBadRequest)
				return
			}
		}
		entry, err := svc.Worklog.Create(r.Context(), tid, domain.CreateWorklogParams{
			TaskID:   taskID,
			UserID:   userID,
			LoggedMd: req.LoggedMd,
			WorkDate: workDate,
			Note:     req.Note,
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, 201, entry)
	}
}
```

- [ ] **Step 4: Register routes in handlers.go**

In `NewRouterWithLoader` (or equivalent), add after the `deleteTask` route:

```go
r.Get("/tasks/{id}/worklogs", listWorklogs(svc))
r.With(libauth.RequireActionScoped(authz, "project.task.update", "Task::{:id}", loaderOpts...)).
    Post("/tasks/{id}/worklogs", createWorklog(svc))
```

- [ ] **Step 5: Run tests**

```bash
cd services/project-svc && go test ./...
```

Expected: all pass including TestListWorklogs and TestCreateWorklog_InvalidLoggedMd

- [ ] **Step 6: Commit**

```bash
git add services/project-svc/
git commit -m "feat(project-svc): worklog GET/POST handlers + tests (Plan #10 Task C)"
```

---

### Task D — Frontend worklog proxy + API client

**Files:**
- Create: `apps/web/app/api/tasks/[id]/worklog/route.ts`
- Create: `apps/web/src/lib/api/worklog.ts`

- [ ] **Step 1: Create proxy route**

Create `apps/web/app/api/tasks/[id]/worklog/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getBackendUrl, forwardHeaders } from "@/lib/api/proxy-utils";

const BASE = getBackendUrl("PROJECT_SVC_URL", "http://localhost:8083");

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${BASE}/v1/tasks/${id}/worklogs`, {
    headers: forwardHeaders(req),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const res = await fetch(`${BASE}/v1/tasks/${id}/worklogs`, {
    method: "POST",
    headers: { ...forwardHeaders(req), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

- [ ] **Step 2: Create worklog API client**

Create `apps/web/src/lib/api/worklog.ts`:

```typescript
export interface WorklogEntry {
  id: string;
  taskId: string;
  userId: string;
  loggedMd: number;
  workDate: string;
  note: string;
  createdAt: string;
}

export async function listWorklogs(taskId: string): Promise<WorklogEntry[]> {
  const res = await fetch(`/api/tasks/${taskId}/worklog`);
  if (!res.ok) throw new Error("Failed to fetch worklogs");
  const data = await res.json();
  return (data.items ?? []).map(normWorklog);
}

export async function createWorklog(
  taskId: string,
  params: { userId: string; loggedMd: number; workDate: string; note: string }
): Promise<WorklogEntry> {
  const res = await fetch(`/api/tasks/${taskId}/worklog`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id:   params.userId,
      logged_md: params.loggedMd,
      work_date: params.workDate,
      note:      params.note,
    }),
  });
  if (!res.ok) throw new Error("Failed to create worklog");
  return normWorklog(await res.json());
}

function normWorklog(r: Record<string, unknown>): WorklogEntry {
  return {
    id:        String(r["id"] ?? r["ID"] ?? ""),
    taskId:    String(r["task_id"] ?? r["TaskID"] ?? r["taskId"] ?? ""),
    userId:    String(r["user_id"] ?? r["UserID"] ?? r["userId"] ?? ""),
    loggedMd:  Number(r["logged_md"] ?? r["LoggedMd"] ?? r["loggedMd"] ?? 0),
    workDate:  String(r["work_date"] ?? r["WorkDate"] ?? r["workDate"] ?? ""),
    note:      String(r["note"] ?? r["Note"] ?? ""),
    createdAt: String(r["created_at"] ?? r["CreatedAt"] ?? r["createdAt"] ?? ""),
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/tasks/ apps/web/src/lib/api/worklog.ts
git commit -m "feat(web): worklog proxy route + API client (Plan #10 Task D)"
```

---

### Task E — WorklogPanel component + TaskSheet "Time" tab

**Files:**
- Create: `apps/web/src/components/WorklogPanel.tsx`
- Modify: `apps/web/src/components/TaskSheet.tsx`

- [ ] **Step 1: Create WorklogPanel**

Create `apps/web/src/components/WorklogPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Clock } from "lucide-react";
import { Button, Input } from "@pmplatform/ui-kit";
import { listWorklogs, createWorklog, type WorklogEntry } from "@/lib/api/worklog";
import { useAuth } from "@/lib/auth/AuthProvider";

interface Props {
  taskId: string;
  estimateMd: number;
  actualMd: number;
}

export function WorklogPanel({ taskId, estimateMd, actualMd }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [loggedMd, setLoggedMd] = useState("");
  const [note, setNote] = useState("");
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["worklogs", taskId],
    queryFn: () => listWorklogs(taskId),
  });

  const mutation = useMutation({
    mutationFn: () =>
      createWorklog(taskId, {
        userId:   user?.id ?? "",
        loggedMd: parseFloat(loggedMd),
        workDate,
        note,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["worklogs", taskId] });
      setLoggedMd("");
      setNote("");
    },
  });

  const totalLogged = entries.reduce((s, e) => s + e.loggedMd, 0);
  const remaining = Math.max(0, estimateMd - totalLogged);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Estimate", value: `${estimateMd}d` },
          { label: "Logged",   value: `${totalLogged.toFixed(1)}d` },
          { label: "Remaining",value: `${remaining.toFixed(1)}d` },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-md border border-border bg-surface-2 px-3 py-2">
            <p className="text-xs text-fgMuted">{label}</p>
            <p className="font-mono text-sm font-semibold text-fg">{value}</p>
          </div>
        ))}
      </div>

      {/* Log form */}
      <div className="rounded-md border border-border p-3 space-y-2">
        <p className="text-xs font-medium text-fgMuted uppercase tracking-wide">Log Time</p>
        <div className="flex gap-2">
          <Input
            placeholder="Days (e.g. 0.5)"
            value={loggedMd}
            onChange={(e) => setLoggedMd(e.target.value)}
            className="w-28"
          />
          <Input
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
            className="w-36"
          />
          <Input
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="flex-1"
          />
          <Button
            size="sm"
            variant="primary"
            disabled={!loggedMd || isNaN(parseFloat(loggedMd)) || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            <Plus size={14} />
          </Button>
        </div>
        {mutation.isError && (
          <p className="text-xs text-danger">{String(mutation.error)}</p>
        )}
      </div>

      {/* Log history */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-surface-2" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-fgMuted">
          <Clock size={28} />
          <p className="text-sm">No time logged yet</p>
        </div>
      ) : (
        <div className="divide-y divide-border rounded-md border border-border">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between px-3 py-2">
              <div>
                <span className="font-mono text-sm font-medium">{e.loggedMd}d</span>
                {e.note && <span className="ml-2 text-xs text-fgMuted">{e.note}</span>}
              </div>
              <span className="text-xs text-fgMuted">{e.workDate}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add "Time" tab to TaskSheet**

In `apps/web/src/components/TaskSheet.tsx`, find the tabs array (look for `"Details"` or `"Activity"` tab entries) and add:

```tsx
{ id: "time", label: "Time" },
```

In the tab content switch/conditional, add a case for `"time"`:

```tsx
{activeTab === "time" && (
  <WorklogPanel
    taskId={task.id}
    estimateMd={task.estimateMd}
    actualMd={task.actualMd}
  />
)}
```

Add the import at the top of `TaskSheet.tsx`:

```tsx
import { WorklogPanel } from "@/components/WorklogPanel";
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck 2>&1 | grep -E "error|Error" | head -20
```

Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/WorklogPanel.tsx apps/web/src/components/TaskSheet.tsx
git commit -m "feat(web): WorklogPanel + TaskSheet Time tab (Plan #10 Task E)"
```

---

### Task F — VelocityChart component + Sprint detail tab

**Files:**
- Create: `apps/web/src/components/VelocityChart.tsx`
- Modify: `apps/web/app/(shell)/pm/sprints/[id]/page.tsx`

- [ ] **Step 1: Create VelocityChart**

Create `apps/web/src/components/VelocityChart.tsx`:

```tsx
"use client";

interface SprintVelocity {
  sprintName: string;
  planned: number;  // estimateMd sum
  actual:  number;  // actualMd sum
}

interface Props {
  data: SprintVelocity[];
}

export function VelocityChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-fgMuted">
        No sprint data yet
      </div>
    );
  }

  const maxVal = Math.max(...data.flatMap((d) => [d.planned, d.actual]), 1);
  const chartH = 180;
  const barW = 28;
  const gap = 12;
  const groupW = barW * 2 + gap + 24;
  const svgW = data.length * groupW + 48;

  return (
    <div className="overflow-x-auto">
      <svg width={svgW} height={chartH + 48} className="text-xs">
        {/* Y gridlines */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = 8 + chartH * (1 - frac);
          return (
            <g key={frac}>
              <line x1={40} x2={svgW - 8} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.1} />
              <text x={36} y={y + 4} textAnchor="end" fill="currentColor" opacity={0.5} fontSize={10}>
                {(maxVal * frac).toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {data.map((d, i) => {
          const x = 48 + i * groupW;
          const pH = (d.planned / maxVal) * chartH;
          const aH = (d.actual  / maxVal) * chartH;
          return (
            <g key={i}>
              {/* Planned bar */}
              <rect
                x={x} y={8 + chartH - pH}
                width={barW} height={pH}
                fill="var(--color-primary)" opacity={0.6} rx={2}
              />
              {/* Actual bar */}
              <rect
                x={x + barW + gap} y={8 + chartH - aH}
                width={barW} height={aH}
                fill="var(--color-success)" opacity={0.8} rx={2}
              />
              {/* Sprint label */}
              <text
                x={x + barW + gap / 2} y={8 + chartH + 16}
                textAnchor="middle" fill="currentColor" opacity={0.7} fontSize={10}
              >
                {d.sprintName.slice(0, 8)}
              </text>
            </g>
          );
        })}

        {/* Legend */}
        <g transform={`translate(${svgW - 120}, ${chartH + 30})`}>
          <rect width={10} height={10} fill="var(--color-primary)" opacity={0.6} rx={1} />
          <text x={14} y={9} fill="currentColor" fontSize={10}>Planned</text>
          <rect x={65} width={10} height={10} fill="var(--color-success)" opacity={0.8} rx={1} />
          <text x={79} y={9} fill="currentColor" fontSize={10}>Actual</text>
        </g>
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Add "Velocity" tab to sprint detail page**

In `apps/web/app/(shell)/pm/sprints/[id]/page.tsx`, find the tabs array and add:

```tsx
{ id: "velocity", label: "Velocity" }
```

Add imports at the top:

```tsx
import { VelocityChart } from "@/components/VelocityChart";
import { listSprintsForProject } from "@/lib/api/sprints";
```

In the tab content, add after the burndown case:

```tsx
{activeTab === "velocity" && (
  <VelocityChart
    data={(allSprints ?? []).map((s) => ({
      sprintName: s.name,
      planned:    s.tasks?.reduce((sum, t) => sum + (t.estimateMd ?? 0), 0) ?? 0,
      actual:     s.tasks?.reduce((sum, t) => sum + (t.actualMd  ?? 0), 0) ?? 0,
    }))}
  />
)}
```

Note: if the sprint page doesn't already fetch all sprints, add a query:

```tsx
const { data: allSprints } = useQuery({
  queryKey: ["sprints", project?.id],
  queryFn: () => project ? listSprintsForProject(project.id) : Promise.resolve([]),
  enabled: !!project?.id,
});
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck 2>&1 | grep -E "error TS" | head -20
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/VelocityChart.tsx apps/web/app/\(shell\)/pm/sprints/
git commit -m "feat(web): VelocityChart + Sprint velocity tab (Plan #10 Task F)"
```

---

### Task G — Product Backlog page

**Files:**
- Create: `apps/web/app/(shell)/pm/backlog/page.tsx`
- Modify: `apps/web/src/lib/mock/apps.ts`

- [ ] **Step 1: Install dnd-kit**

```bash
cd apps/web && pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: Create backlog page**

Create `apps/web/app/(shell)/pm/backlog/page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, RefreshCw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { listAllTasks, updateTask, type Task, type TaskPriority, type TaskType } from "@/lib/api/tasks";
import { listProjects } from "@/lib/api/projects";
import { priorityTone, statusTone } from "@/lib/api/taskTones";
import { TaskSheet } from "@/components/TaskSheet";

// ─── Sortable row ──────────────────────────────────────────────────────────────

function BacklogRow({ task, onOpen }: { task: Task; onOpen: (t: Task) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 border-b border-border bg-surface px-3 py-2 text-sm
        hover:bg-surface-2 cursor-pointer ${isDragging ? "opacity-50 shadow-lg z-50" : ""}`}
      onClick={() => onOpen(task)}
    >
      <button
        {...attributes} {...listeners}
        className="text-fgMuted hover:text-fg cursor-grab active:cursor-grabbing p-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={14} />
      </button>
      <span className="font-mono text-xs text-fgMuted w-20 shrink-0">{task.code}</span>
      <span className="flex-1 truncate">{task.title}</span>
      <Tag tone={priorityTone(task.priority)} size="sm">{task.priority}</Tag>
      <Tag tone={statusTone(task.status)} size="sm">{task.status}</Tag>
      <span className="font-mono text-xs text-fgMuted w-12 text-right">{task.estimateMd}d</span>
    </div>
  );
}

// ─── Filters ──────────────────────────────────────────────────────────────────

const TYPE_FILTERS: Array<{ value: TaskType | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "task", label: "Task" },
  { value: "bug", label: "Bug" },
  { value: "risk", label: "Risk" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BacklogPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TaskType | "">("");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [localOrder, setLocalOrder] = useState<Task[]>([]);

  const { data: tasks = [], isLoading, refetch } = useQuery({
    queryKey: ["backlog-tasks"],
    queryFn: () => listAllTasks({ status: "todo,in_progress,blocked,review" }),
    select: (items) =>
      [...items].sort((a, b) => a.sortOrder - b.sortOrder),
  });

  useEffect(() => {
    if (tasks.length) setLocalOrder(tasks);
  }, [tasks]);

  const sensors = useSensors(useSensor(PointerSensor));

  const reorderMutation = useMutation({
    mutationFn: async ({ id, sortOrder }: { id: string; sortOrder: number }) =>
      updateTask(id, { sort_order: sortOrder }),
  });

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLocalOrder((prev) => {
      const oldIndex = prev.findIndex((t) => t.id === active.id);
      const newIndex = prev.findIndex((t) => t.id === over.id);
      const reordered = arrayMove(prev, oldIndex, newIndex);
      // persist new sort_order values
      reordered.forEach((t, i) => {
        if (t.sortOrder !== i * 10) {
          reorderMutation.mutate({ id: t.id, sortOrder: i * 10 });
        }
      });
      return reordered;
    });
  }, [reorderMutation]);

  const filtered = localOrder.filter((t) => {
    if (typeFilter && t.type !== typeFilter) return false;
    if (search && !t.title.toLowerCase().includes(search.toLowerCase()) &&
        !t.code.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      <Breadcrumb items={[{ label: "PM Hub", href: "/pm/home" }, { label: "Backlog" }]} />
      <CommandBar
        actions={[
          { label: "Refresh", icon: RefreshCw, onClick: () => refetch() },
        ]}
      />

      {/* Filters */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Input
          placeholder="Search title or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56"
        />
        <div className="flex gap-1">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value as TaskType | "")}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors
                ${typeFilter === f.value
                  ? "bg-primary text-white"
                  : "bg-surface-2 text-fgMuted hover:text-fg"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-fgMuted">{filtered.length} items</span>
      </div>

      {/* Column header */}
      <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-fgMuted">
        <span className="w-5" />
        <span className="w-20">Code</span>
        <span className="flex-1">Title</span>
        <span className="w-16">Priority</span>
        <span className="w-20">Status</span>
        <span className="w-12 text-right">Est.</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-px p-0">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 animate-pulse border-b border-border bg-surface-2" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-fgMuted">
            <p className="text-sm">No backlog items match your filters.</p>
            <Button size="sm" variant="ghost" onClick={() => { setSearch(""); setTypeFilter(""); }}>
              Clear filters
            </Button>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={filtered.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {filtered.map((task) => (
                <BacklogRow key={task.id} task={task} onOpen={setSelectedTask} />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {selectedTask && (
        <TaskSheet
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["backlog-tasks"] }); setSelectedTask(null); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add Backlog to PM nav**

In `apps/web/src/lib/mock/apps.ts`, find the PM hub `subareas` array under `"Projects"` group and add after `tasks`:

```typescript
{ id: "backlog", name: "Backlog", href: "/pm/backlog", icon: "tasks", count: 0 },
```

- [ ] **Step 4: Verify `updateTask` accepts `sort_order`**

In `apps/web/src/lib/api/tasks.ts`, check that `UpdateTaskParams` includes `sort_order?: number`. If not, add it:

```typescript
export interface UpdateTaskParams {
  // ... existing fields ...
  sort_order?: number;
}
```

And in the `updateTask` function body ensure `sort_order` is passed through.

- [ ] **Step 5: Typecheck + build**

```bash
pnpm --filter web typecheck 2>&1 | grep "error TS" | head -20
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(shell\)/pm/backlog/ apps/web/src/lib/mock/apps.ts
git commit -m "feat(web): Product Backlog page with drag-to-prioritize (Plan #10 Task G)"
```

---

### Task H — Integration + final commit

- [ ] **Step 1: Start dev server and verify**

```bash
pnpm --filter web dev
```

Navigate to:
- `/pm/backlog` — verify backlog loads, drag reorders, task sheet opens with Time tab
- `/pm/sprints/[any-id]` — verify Velocity tab shows chart
- TaskSheet → Time tab → log 0.5 days → verify it appears in worklog list

- [ ] **Step 2: Run all frontend tests**

```bash
pnpm --filter web test -- --run
```

Expected: all pass

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "feat(platform): Plan #10 complete — Backlog, Worklog, Velocity chart"
```
