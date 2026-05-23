# Plan #9 — Platform Completeness: User Picker, Burndown, Profile

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to execute task-by-task. Steps use `- [ ]` checkbox syntax for tracking.

**Goal:** Close the remaining UX gaps found in SA gap analysis after Plan #8 was completed. The platform backend is largely functional — this plan fixes the surface-level gaps that make the UI feel incomplete to real users.

**SA Analysis Summary (2026-05-23):**
After thorough code audit, the system is ~85% complete. Backend services (project-svc, quality-svc, workflow-svc, reports-svc, mfg-svc) all have implemented handlers. The remaining gaps are:

| Gap | Severity | Root Cause |
|-----|----------|-----------|
| Profile page uses wrong design tokens | High | Page was scaffolded before industrial token system was finalized |
| Sprint detail has no Burndown chart | High | Explicitly deferred to phase 2 (`{/* Burndown placeholder */}`) |
| Project/Task owner & assignee fields are raw UUID inputs | Critical | `identity-svc` has no user list/search endpoint — cannot build a picker without it |
| No user list endpoint in identity-svc | Critical | `user_store.go` has `FindByID` + `FindByEmail` but no `List`/`Search` |
| `[app]/home` page uses stale token classes | Medium | Same scaffolding issue as profile page |

**Dependencies:** Tasks A → B → C (B needs A's new identity endpoint; C needs B's component). D and E are independent of A–C.

---

## File Map

```
Modified (Go):
  services/identity-svc/internal/store/user_store.go     add List method
  services/identity-svc/internal/api/handlers.go          add GET /v1/users handler
  services/identity-svc/internal/domain/types.go          add UserSummary type

Modified / New (Frontend):
  apps/web/app/api/identity/users/route.ts                new proxy route → identity-svc GET /v1/users
  apps/web/src/lib/api/identity.ts                        new API client (listUsers)
  apps/web/src/components/UserPicker.tsx                  new shared component
  apps/web/app/(shell)/pm/projects/[id]/page.tsx          wire UserPicker into owner field
  apps/web/app/(shell)/pm/tasks/page.tsx                  wire UserPicker into assignee field
  apps/web/app/(shell)/pm/sprints/[id]/page.tsx           replace burndown placeholder with BurndownChart
  apps/web/src/components/BurndownChart.tsx               new pure-CSS / SVG line chart
  apps/web/app/(shell)/profile/page.tsx                   redesign with industrial tokens
  apps/web/app/(shell)/[app]/home/page.tsx                fix stale token classes
```

---

## Task A — identity-svc: User list/search endpoint

**Agent:** `go-service-engineer`
**Effort:** S (half day)

**Context:** `services/identity-svc/internal/store/user_store.go` has `FindByID`, `FindByEmail`, `Create`, `UpdatePassword`, `RolesForUser`. It queries the `app_user` table. There is NO list or search method. The `user` domain type in `services/identity-svc/internal/domain/types.go` has `ID`, `TenantID`, `Email`, `DisplayName`, `PasswordHash`, `CreatedAt`.

**Changes:**

### Step 1 — Add `UserSummary` to domain

In `services/identity-svc/internal/domain/types.go`, add after the `User` struct:

```go
// UserSummary is a read-only view for pickers — no sensitive fields.
type UserSummary struct {
	ID          uuid.UUID `json:"id"`
	DisplayName string    `json:"display_name"`
	Email       string    `json:"email"`
}
```

### Step 2 — Add `List` method to user store

In `services/identity-svc/internal/store/user_store.go`, add:

```go
// List returns up to limit users in the tenant matching the optional q filter
// (case-insensitive prefix on display_name or email). max limit is 100.
func (s *Users) List(ctx context.Context, tid uuid.UUID, q string, limit int) ([]domain.UserSummary, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	var rows pgx.Rows
	var err error
	if q == "" {
		rows, err = s.p.Query(ctx,
			`SELECT id, display_name, email FROM app_user
			 WHERE tenant_id=$1 ORDER BY display_name LIMIT $2`,
			tid, limit)
	} else {
		pattern := "%" + strings.ToLower(q) + "%"
		rows, err = s.p.Query(ctx,
			`SELECT id, display_name, email FROM app_user
			 WHERE tenant_id=$1 AND (lower(display_name) LIKE $2 OR lower(email) LIKE $2)
			 ORDER BY display_name LIMIT $3`,
			tid, pattern, limit)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.UserSummary
	for rows.Next() {
		var u domain.UserSummary
		if err := rows.Scan(&u.ID, &u.DisplayName, &u.Email); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	if out == nil {
		out = []domain.UserSummary{}
	}
	return out, rows.Err()
}
```

Add `"strings"` to the import block.

### Step 3 — Add GET /v1/users handler

In `services/identity-svc/internal/api/handlers.go`, add a handler function:

```go
func listUsers(users *store.Users) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := libauth.ClaimsFrom(r.Context())
		if !ok {
			writeErr(w, 401, errors.New("unauthenticated"))
			return
		}
		tid, err := uuid.Parse(claims.TenantID)
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		q := r.URL.Query().Get("q")
		limit := 50
		if lStr := r.URL.Query().Get("limit"); lStr != "" {
			if n, err2 := strconv.Atoi(lStr); err2 == nil && n > 0 {
				limit = n
			}
		}
		list, err := users.List(r.Context(), tid, q, limit)
		if err != nil {
			writeErr(w, 500, err)
			return
		}
		writeJSON(w, 200, map[string]any{"users": list})
	}
}
```

### Step 4 — Register the route in `NewRouter`

Find the route block in `services/identity-svc/internal/api/handlers.go` `NewRouter` (or `NewRouterWithLoader`) and add inside the `/v1` route group:

```go
// User list/search — any authenticated tenant member may call this
r.With(libauth.Require).Get("/users", listUsers(h.users))
```

Where `h.users` is the `*store.Users` already passed to the handler struct. Check the handler struct definition in that file and add the field if needed.

### Step 5 — Add proxy route in Next.js

Create `apps/web/app/api/identity/users/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { currentTenantId, currentAccessToken } from "@/lib/auth/serverTenant";

const SVC = process.env.IDENTITY_URL ?? "http://localhost:8082";

export async function GET(req: Request) {
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const at = await currentAccessToken();
  const url = new URL(req.url);
  const target = `${SVC}/v1/users${url.search}`;
  const headers: Record<string, string> = { "X-Tenant-Id": tid };
  if (at) headers["Authorization"] = `Bearer ${at}`;
  const res = await fetch(target, { headers, cache: "no-store" });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

### Step 6 — Add identity API client

Create `apps/web/src/lib/api/identity.ts`:

```typescript
export interface UserSummary {
  id: string;
  display_name: string;
  email: string;
}

export async function listUsers(q?: string, limit = 50): Promise<UserSummary[]> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("limit", String(limit));
  const res = await fetch(`/api/identity/users?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`listUsers: ${res.status}`);
  const data = (await res.json()) as { users: UserSummary[] };
  return data.users;
}
```

### Step 7 — Build + test

```bash
cd services/identity-svc && go build ./... && TEST_DATABASE_URL="postgres://app:app@localhost:5432/platform?sslmode=disable" go test ./...
```

- [ ] Step 1: Add UserSummary to domain/types.go
- [ ] Step 2: Add List method to user_store.go
- [ ] Step 3: Add listUsers handler function
- [ ] Step 4: Register GET /v1/users in router
- [ ] Step 5: Create proxy route apps/web/app/api/identity/users/route.ts
- [ ] Step 6: Create apps/web/src/lib/api/identity.ts
- [ ] Step 7: go build + go test pass

---

## Task B — Frontend: UserPicker component + wire into Project & Task

**Agent:** `frontend-ui-engineer`
**Effort:** M (1 day)
**Depends on:** Task A (identity.ts must exist)

**Context:** Two places currently have raw UUID text inputs for user selection:
1. `apps/web/app/(shell)/pm/projects/[id]/page.tsx` — project edit form has `<Input value={form.owner_id} ... placeholder="UUID of owner (identity lookup in Phase 2)" />`
2. `apps/web/app/(shell)/pm/tasks/page.tsx` — task create form has assignee field using `<InitialsAvatar id={task.assigneeId} />` (display only, no picker in create dialog)
3. Sprint detail assignee display.

**Create `apps/web/src/components/UserPicker.tsx`:**

```typescript
"use client";
import { useEffect, useRef, useState } from "react";
import { listUsers, type UserSummary } from "@/lib/api/identity";

interface UserPickerProps {
  value?: string;        // user id
  onChange: (userId: string, user: UserSummary | null) => void;
  placeholder?: string;
  className?: string;
}

export function UserPicker({ value, onChange, placeholder = "Search members…", className }: UserPickerProps) {
  // Typeahead search with debounce, dropdown of matching users.
  // When a user is selected, calls onChange with id and full UserSummary.
  // Displays selected user as "Display Name <email>" chip with ×-clear button.
  // Falls back to raw UUID display if user not resolved.
}
```

Implementation requirements:
- Input field: typing queries `listUsers(q)` with 300ms debounce
- Dropdown: max 6 results, each row shows `DisplayName` + small `email` in ink-3
- Selected state: chip showing initials avatar + display name + `×` clear button
- Keyboard: Arrow keys navigate list, Enter selects, Escape closes
- When `value` prop is provided but no name resolved, show truncated UUID as placeholder
- Style: follows existing Input + dropdown pattern from task/item search in other pages (see `apps/web/app/(shell)/mfg/work-orders/page.tsx` for the item search typeahead pattern)

**Wire into projects/[id]/page.tsx:**
- Replace `<Input value={form.owner_id} onChange={e => setForm(f => ({ ...f, owner_id: e.target.value }))} placeholder="UUID of owner (identity lookup in Phase 2)" />` with `<UserPicker value={form.owner_id} onChange={(id) => setForm(f => ({ ...f, owner_id: id }))} />`

**Wire into tasks page create dialog:**
- Find the task create dialog's assignee field (currently the InitialsAvatar is display-only in the list). Add `<UserPicker value={form.assignee_id} onChange={(id) => setForm(f => ({ ...f, assignee_id: id }))} placeholder="Assign to…" />` in the new task form.

**Checklist:**
- [ ] Create apps/web/src/components/UserPicker.tsx with typeahead + debounce
- [ ] Wire into projects/[id]/page.tsx owner field
- [ ] Wire into tasks page create dialog assignee field
- [ ] `pnpm --filter web build` passes with 0 type errors

---

## Task C — Frontend: Sprint Burndown Chart

**Agent:** `frontend-ui-engineer`
**Effort:** M (1 day)
**Independent of A and B**

**Context:** `apps/web/app/(shell)/pm/sprints/[id]/page.tsx` line 629 has:
```tsx
{/* Burndown placeholder */}
Burndown chart — phase 2
```

The sprint data available on this page:
- `sprint.startDate`, `sprint.endDate`, `sprint.capacity` (story points)
- `tasks` array loaded by `listTasksForSprint(id)` — each task has `estimateMd` (estimate in man-days) and `status` (todo/in_progress/blocked/review/done)

**Create `apps/web/src/components/BurndownChart.tsx`:**

Data shape to compute from tasks:
```typescript
interface BurndownPoint {
  day: string;       // "May 23"
  ideal: number;     // linear remaining from capacity → 0
  actual: number;    // remaining estimate for incomplete tasks
}
```

Implementation:
- Compute ideal line: from sprint start to end, linear decrease from `totalEstimate` to 0
- Compute actual line: for each completed task, note its `updated_at` date; remaining = total − sum(completed estimates) up to each day
- Render as inline SVG: `viewBox="0 0 500 200"`, two polylines (ideal in ink-3 dashed, actual in accent solid), x-axis dates, y-axis story points
- If sprint has no tasks yet: show empty state "No tasks to chart"
- Use `JetBrains Mono` for axis labels (already a global font)
- Container class: `border border-line bg-paper rounded-sm p-4`

**Wire into sprint [id] page:**
- Remove the `{/* Burndown placeholder */}` block
- Import `BurndownChart` and render `<BurndownChart sprint={sprint} tasks={sprintTasks} />` in its place
- If `sprintTasks` is not already loaded on this page, add `listTasksForSprint(id)` call alongside the sprint load (check if it already loads tasks for the Kanban/list view on this page)

**Checklist:**
- [ ] Create apps/web/src/components/BurndownChart.tsx
- [ ] Wire into apps/web/app/(shell)/pm/sprints/[id]/page.tsx
- [ ] Chart renders ideal + actual lines
- [ ] Empty state for no tasks
- [ ] `pnpm --filter web build` passes

---

## Task D — Frontend: Profile page redesign

**Agent:** `frontend-ui-engineer`
**Effort:** S (2 hours)
**Independent**

**Context:** `apps/web/app/(shell)/profile/page.tsx` uses old Tailwind token names that don't exist in the industrial design system:
- `bg-primary` → `bg-accent`
- `text-fgMuted` → `text-ink-3`
- `border-border` → `border-line`
- `bg-bg` → `bg-paper`
- `bg-bgMuted` → `bg-surface`
- `shadow-sm` → (remove or use `shadow-pop` from ui-kit)

**Full redesign** — convert this server component to an industrial-style card:

```tsx
// Industrial profile card — matches the dense instrument-panel UX of other pages
<div className="mx-auto max-w-xl px-4 py-8">
  <div className="rounded-sm border border-line bg-paper p-5">
    {/* Header row */}
    <div className="flex items-center gap-4 border-b border-line pb-4">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent font-mono text-lg font-semibold text-white">
        {user.displayName.charAt(0).toUpperCase()}
      </div>
      <div>
        <div className="font-semibold text-ink">{user.displayName}</div>
        <div className="font-mono text-[11px] text-ink-3">{user.email}</div>
      </div>
    </div>
    {/* Detail rows */}
    <dl className="mt-4 space-y-2 text-[12px]">
      <div className="flex gap-4">
        <dt className="w-28 font-mono uppercase tracking-wider text-ink-3">User ID</dt>
        <dd className="font-mono text-[11px] text-ink">{user.id}</dd>
      </div>
      <div className="flex gap-4">
        <dt className="w-28 font-mono uppercase tracking-wider text-ink-3">Tenant</dt>
        <dd className="text-ink">{user.tenantSlug ?? user.tenantId}</dd>
      </div>
      <div className="flex gap-4">
        <dt className="w-28 font-mono uppercase tracking-wider text-ink-3">Roles</dt>
        <dd className="flex flex-wrap gap-1">
          {user.roles?.map(r => <Tag key={r} tone="neutral" size="sm">{r}</Tag>)}
        </dd>
      </div>
    </dl>
    {/* Note */}
    <p className="mt-5 rounded-sm border border-line bg-surface px-3 py-2 font-mono text-[11px] text-ink-3">
      Password changes and role management are handled by your tenant administrator.
    </p>
  </div>
</div>
```

Also fix the `currentUser()` import — check if `user.roles`, `user.tenantSlug` are available from the JWT claims returned by `@/lib/auth/me`. If not available, display what is.

**Checklist:**
- [ ] Replace all stale token classes with industrial equivalents
- [ ] Page renders cleanly with correct visual style
- [ ] `pnpm --filter web build` passes

---

## Task E — Integration Smoke Test

**Agent:** `integration-tester`
**Effort:** S
**Depends on:** A (identity endpoint must exist to test)

Boot all services and verify end-to-end:

```bash
# Build all Go services
cd services/identity-svc && go build ./... 2>&1 | head -5
cd services/project-svc && go build ./... 2>&1 | head -5
cd services/quality-svc && go build ./... 2>&1 | head -5
cd services/workflow-svc && go build ./... 2>&1 | head -5
cd services/reports-svc && go build ./... 2>&1 | head -5
cd services/mfg-svc && go build ./... 2>&1 | head -5
cd services/notification-svc && go build ./... 2>&1 | head -5
cd services/audit-svc && go build ./... 2>&1 | head -5

# Run unit + integration tests per service
cd services/identity-svc && TEST_DATABASE_URL="postgres://app:app@localhost:5432/platform?sslmode=disable" go test ./... 2>&1 | tail -10
cd services/project-svc && TEST_DATABASE_URL="postgres://app:app@localhost:5432/platform?sslmode=disable" go test ./... 2>&1 | tail -10
cd services/quality-svc && TEST_DATABASE_URL="postgres://app:app@localhost:5432/platform?sslmode=disable" go test ./... 2>&1 | tail -10
cd services/reports-svc && TEST_DATABASE_URL="postgres://app:app@localhost:5432/platform?sslmode=disable" go test ./... 2>&1 | tail -10

# Frontend build
cd apps/web && pnpm build 2>&1 | tail -20
```

Report:
- Which services build cleanly
- Which tests pass / fail, and why
- Any missing migrations or schema mismatches

**Checklist:**
- [ ] All Go services compile with `go build ./...`
- [ ] identity-svc tests pass
- [ ] project-svc tests pass
- [ ] quality-svc tests pass
- [ ] reports-svc tests pass
- [ ] `pnpm --filter web build` exits 0 with 0 type errors
- [ ] Document any failures with root cause

---

## Verification

After all tasks complete:

1. **User Picker:** Open `/pm/projects` → click a project → Edit → Owner field shows typeahead dropdown → select a user → owner_id updates to real UUID
2. **Task Assignee:** Open `/pm/tasks` → New Task → Assignee field has picker → select user
3. **Burndown:** Open `/pm/sprints` → click a sprint with tasks → Detail tab shows burndown chart with ideal + actual lines
4. **Profile:** Open `/profile` → sees industrial-token styled card (no bg-primary class)
5. `pnpm --filter web build` → 0 type errors

---

## Execution Order

```
Day 1:  A (backend, go-service-engineer) → parallel with D (frontend profile fix)
Day 2:  B (UserPicker — needs A) → parallel with C (Burndown — independent)
Day 2:  E (smoke test — after A is merged)
```

---

## Self-Review

- No new migrations needed (user list uses existing `app_user` table)
- No new npm packages needed (SVG burndown is pure inline)
- Profile fix is additive-only — no API changes
- UserPicker is a new component, wired into two existing pages — no risk of breaking other flows
- identity-svc user list endpoint requires auth (uses `libauth.Require`) — no anonymous access
