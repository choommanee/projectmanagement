# Plan #13 — Reports BI Builder UI + Custom Fields Configuration UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a drag-widget dashboard builder on top of the existing reports-svc, and a Custom Fields configuration UI for per-tenant EAV field definitions.

**Architecture:**
- **BI Builder**: A `DashboardBuilder` component using `react-grid-layout` for drag-resize widget placement. Widget types: KPI tile, bar chart, line chart, table. Data source: existing `reports-svc` REST API (port 8092). Dashboard definitions are saved as JSON in the browser (localStorage) initially — backend persistence deferred.
- **Custom Fields UI**: A configuration page at `/pm/tenants/fields` and `/mfg/tenants/fields` that reads/writes `custom_field_definition` records via a new endpoint on `tenant-svc`. The EAV schema (`custom_field_definition` table) needs a migration if not yet present.

**Tech Stack:** `react-grid-layout`, recharts (already used or add), Go chi + pgx, Next.js 15.

---

## File Map

```
New (Migration — if not exists):
  infra/migrations/tenant/00003_custom_fields.sql

New / Modified (Go — tenant-svc):
  services/tenant-svc/internal/domain/custom_field.go   new — FieldType, CustomFieldDef
  services/tenant-svc/internal/store/custom_field_store.go  new — List / Create / Delete
  services/tenant-svc/internal/api/handlers.go          add custom field handlers + routes

New (Frontend proxy):
  apps/web/app/api/tenants/fields/route.ts              GET list + POST create
  apps/web/app/api/tenants/fields/[id]/route.ts         DELETE

New (Frontend lib):
  apps/web/src/lib/api/customFields.ts                  listFields / createField / deleteField

New (Frontend components):
  apps/web/src/components/DashboardBuilder.tsx          drag-widget dashboard
  apps/web/src/components/widgets/KpiWidget.tsx         KPI tile widget
  apps/web/src/components/widgets/ChartWidget.tsx       bar/line chart widget
  apps/web/src/components/widgets/TableWidget.tsx       table widget
  apps/web/src/components/CustomFieldsAdmin.tsx         field config table

New (Frontend pages):
  apps/web/app/(shell)/pm/reports/dashboard/page.tsx    BI Builder page
  apps/web/app/(shell)/pm/tenants/fields/page.tsx       Custom Fields admin page

Modified:
  apps/web/src/lib/mock/apps.ts                         add Dashboard + Custom Fields nav entries
```

---

### Task A — Custom field migration + domain

**Files:**
- Create: `infra/migrations/tenant/00003_custom_fields.sql`

- [ ] **Step 1: Check if custom_field_definition already exists**

```bash
psql -U app -d platform -c "\d custom_field_definition" 2>&1
```

If the table exists, skip to Task B. If not, continue.

- [ ] **Step 2: Write migration**

Create `infra/migrations/tenant/00003_custom_fields.sql`:

```sql
-- +goose Up
CREATE TABLE IF NOT EXISTS custom_field_definition (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('task','project','work_order','item','document')),
  field_key    TEXT NOT NULL,
  label        TEXT NOT NULL,
  field_type   TEXT NOT NULL CHECK (field_type IN ('text','number','date','dropdown','user','boolean')),
  options      JSONB NOT NULL DEFAULT '[]',
  required     BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity_type, field_key)
);

ENABLE ROW LEVEL SECURITY ON custom_field_definition;
ALTER TABLE custom_field_definition FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON custom_field_definition
  USING (tenant_id = current_tenant_uuid());

CREATE INDEX ix_custom_field_entity ON custom_field_definition (tenant_id, entity_type);

-- +goose Down
DROP TABLE IF EXISTS custom_field_definition;
```

- [ ] **Step 3: Run migration**

```bash
tools/scripts/migrate.sh up tenant
```

Expected: successful migration

- [ ] **Step 4: Create domain type**

Create `services/tenant-svc/internal/domain/custom_field.go`:

```go
package domain

import (
	"time"
	"github.com/google/uuid"
)

type FieldType string

const (
	FieldText     FieldType = "text"
	FieldNumber   FieldType = "number"
	FieldDate     FieldType = "date"
	FieldDropdown FieldType = "dropdown"
	FieldUser     FieldType = "user"
	FieldBoolean  FieldType = "boolean"
)

type CustomFieldDef struct {
	ID         uuid.UUID
	TenantID   uuid.UUID
	EntityType string
	FieldKey   string
	Label      string
	FieldType  FieldType
	Options    []string // for dropdown type
	Required   bool
	SortOrder  int
	CreatedAt  time.Time
}

type CreateCustomFieldParams struct {
	EntityType string
	FieldKey   string
	Label      string
	FieldType  FieldType
	Options    []string
	Required   bool
	SortOrder  int
}
```

- [ ] **Step 5: Commit**

```bash
git add infra/migrations/tenant/ services/tenant-svc/internal/domain/custom_field.go
git commit -m "feat(tenant): custom_field_definition table + domain type (Plan #13 Task A)"
```

---

### Task B — Custom field store + API handlers

**Files:**
- Create: `services/tenant-svc/internal/store/custom_field_store.go`
- Modify: `services/tenant-svc/internal/api/handlers.go`

- [ ] **Step 1: Create custom field store**

Create `services/tenant-svc/internal/store/custom_field_store.go`:

```go
package store

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	libdb "github.com/your-org/pm-platform/libs/go/db"

	"tenant-svc/internal/domain"
)

type CustomFieldStore struct{ pool *pgxpool.Pool }

func NewCustomFieldStore(pool *pgxpool.Pool) *CustomFieldStore {
	return &CustomFieldStore{pool: pool}
}

func (s *CustomFieldStore) List(ctx context.Context, tenantID uuid.UUID, entityType string) ([]domain.CustomFieldDef, error) {
	ctx = libdb.WithTenant(ctx, tenantID)
	q := `SELECT id, tenant_id, entity_type, field_key, label, field_type, options, required, sort_order, created_at
	      FROM custom_field_definition`
	args := []any{}
	if entityType != "" {
		q += " WHERE entity_type = $1"
		args = append(args, entityType)
	}
	q += " ORDER BY sort_order, created_at"
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.CustomFieldDef
	for rows.Next() {
		var f domain.CustomFieldDef
		var optBytes []byte
		if err := rows.Scan(&f.ID, &f.TenantID, &f.EntityType, &f.FieldKey, &f.Label,
			(*string)(&f.FieldType), &optBytes, &f.Required, &f.SortOrder, &f.CreatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal(optBytes, &f.Options)
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *CustomFieldStore) Create(ctx context.Context, tenantID uuid.UUID, p domain.CreateCustomFieldParams) (domain.CustomFieldDef, error) {
	ctx = libdb.WithTenant(ctx, tenantID)
	opts, _ := json.Marshal(p.Options)
	var f domain.CustomFieldDef
	var optBytes []byte
	err := s.pool.QueryRow(ctx, `
		INSERT INTO custom_field_definition
		  (tenant_id, entity_type, field_key, label, field_type, options, required, sort_order)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING id, tenant_id, entity_type, field_key, label, field_type, options, required, sort_order, created_at`,
		tenantID, p.EntityType, p.FieldKey, p.Label, string(p.FieldType), opts, p.Required, p.SortOrder,
	).Scan(&f.ID, &f.TenantID, &f.EntityType, &f.FieldKey, &f.Label,
		(*string)(&f.FieldType), &optBytes, &f.Required, &f.SortOrder, &f.CreatedAt)
	_ = json.Unmarshal(optBytes, &f.Options)
	return f, err
}

func (s *CustomFieldStore) Delete(ctx context.Context, tenantID, id uuid.UUID) error {
	ctx = libdb.WithTenant(ctx, tenantID)
	_, err := s.pool.Exec(ctx, `DELETE FROM custom_field_definition WHERE id = $1`, id)
	return err
}
```

- [ ] **Step 2: Add handlers to tenant-svc**

In `services/tenant-svc/internal/api/handlers.go`, add after existing handlers:

```go
// GET /v1/custom-fields?entity_type=task
func listCustomFields(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid := tenantID(r)
		entityType := r.URL.Query().Get("entity_type")
		fields, err := svc.CustomFields.List(r.Context(), tid, entityType)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if fields == nil {
			fields = []domain.CustomFieldDef{}
		}
		writeJSON(w, 200, map[string]any{"items": fields, "total": len(fields)})
	}
}

// POST /v1/custom-fields
func createCustomField(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid := tenantID(r)
		var req struct {
			EntityType string   `json:"entity_type"`
			FieldKey   string   `json:"field_key"`
			Label      string   `json:"label"`
			FieldType  string   `json:"field_type"`
			Options    []string `json:"options"`
			Required   bool     `json:"required"`
			SortOrder  int      `json:"sort_order"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.FieldKey == "" || req.Label == "" {
			http.Error(w, "invalid body: field_key and label required", http.StatusBadRequest)
			return
		}
		f, err := svc.CustomFields.Create(r.Context(), tid, domain.CreateCustomFieldParams{
			EntityType: req.EntityType,
			FieldKey:   req.FieldKey,
			Label:      req.Label,
			FieldType:  domain.FieldType(req.FieldType),
			Options:    req.Options,
			Required:   req.Required,
			SortOrder:  req.SortOrder,
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, 201, f)
	}
}

// DELETE /v1/custom-fields/{id}
func deleteCustomField(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid := tenantID(r)
		id, err := uuid.Parse(chi.URLParam(r, "id"))
		if err != nil {
			http.Error(w, "invalid id", http.StatusBadRequest)
			return
		}
		if err := svc.CustomFields.Delete(r.Context(), tid, id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
```

Register routes in the v1 group:

```go
r.Get("/custom-fields", listCustomFields(svc))
r.With(libauth.RequireAction(authz, "tenant.admin", "*")).Post("/custom-fields", createCustomField(svc))
r.With(libauth.RequireAction(authz, "tenant.admin", "*")).Delete("/custom-fields/{id}", deleteCustomField(svc))
```

Wire `CustomFields` into Service struct and main.go:
```go
// service struct:
CustomFields *store.CustomFieldStore

// main.go:
svc.CustomFields = store.NewCustomFieldStore(pool)
```

- [ ] **Step 3: Build check**

```bash
cd services/tenant-svc && go build ./...
```

- [ ] **Step 4: Commit**

```bash
git add services/tenant-svc/
git commit -m "feat(tenant-svc): custom field CRUD endpoints (Plan #13 Task B)"
```

---

### Task C — Frontend custom fields proxy + client

**Files:**
- Create: `apps/web/app/api/tenants/fields/route.ts`
- Create: `apps/web/app/api/tenants/fields/[id]/route.ts`
- Create: `apps/web/src/lib/api/customFields.ts`

- [ ] **Step 1: Create proxy routes**

Create `apps/web/app/api/tenants/fields/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getBackendUrl, forwardHeaders } from "@/lib/api/proxy-utils";

const BASE = getBackendUrl("TENANT_SVC_URL", "http://localhost:8081");

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString();
  const url = `${BASE}/v1/custom-fields${qs ? "?" + qs : ""}`;
  const res = await fetch(url, { headers: forwardHeaders(req) });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await fetch(`${BASE}/v1/custom-fields`, {
    method: "POST",
    headers: { ...forwardHeaders(req), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

Create `apps/web/app/api/tenants/fields/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getBackendUrl, forwardHeaders } from "@/lib/api/proxy-utils";

const BASE = getBackendUrl("TENANT_SVC_URL", "http://localhost:8081");

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await fetch(`${BASE}/v1/custom-fields/${id}`, {
    method: "DELETE",
    headers: forwardHeaders(req),
  });
  return new NextResponse(null, { status: res.status });
}
```

- [ ] **Step 2: Create API client**

Create `apps/web/src/lib/api/customFields.ts`:

```typescript
export type FieldType = "text" | "number" | "date" | "dropdown" | "user" | "boolean";
export type EntityType = "task" | "project" | "work_order" | "item" | "document";

export interface CustomFieldDef {
  id: string;
  entityType: EntityType;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  options: string[];
  required: boolean;
  sortOrder: number;
  createdAt: string;
}

export async function listCustomFields(entityType?: EntityType): Promise<CustomFieldDef[]> {
  const qs = entityType ? `?entity_type=${entityType}` : "";
  const res = await fetch(`/api/tenants/fields${qs}`);
  if (!res.ok) throw new Error("Failed to fetch custom fields");
  const data = await res.json();
  return (data.items ?? []).map(normField);
}

export async function createCustomField(params: Omit<CustomFieldDef, "id" | "createdAt">): Promise<CustomFieldDef> {
  const res = await fetch("/api/tenants/fields", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entity_type: params.entityType,
      field_key:   params.fieldKey,
      label:       params.label,
      field_type:  params.fieldType,
      options:     params.options,
      required:    params.required,
      sort_order:  params.sortOrder,
    }),
  });
  if (!res.ok) throw new Error("Failed to create custom field");
  return normField(await res.json());
}

export async function deleteCustomField(id: string): Promise<void> {
  const res = await fetch(`/api/tenants/fields/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete custom field");
}

function normField(r: Record<string, unknown>): CustomFieldDef {
  return {
    id:         String(r["id"] ?? r["ID"] ?? ""),
    entityType: String(r["entity_type"] ?? r["EntityType"] ?? r["entityType"] ?? "") as EntityType,
    fieldKey:   String(r["field_key"] ?? r["FieldKey"] ?? r["fieldKey"] ?? ""),
    label:      String(r["label"] ?? r["Label"] ?? ""),
    fieldType:  String(r["field_type"] ?? r["FieldType"] ?? r["fieldType"] ?? "text") as FieldType,
    options:    (r["options"] ?? r["Options"] ?? []) as string[],
    required:   Boolean(r["required"] ?? r["Required"] ?? false),
    sortOrder:  Number(r["sort_order"] ?? r["SortOrder"] ?? r["sortOrder"] ?? 0),
    createdAt:  String(r["created_at"] ?? r["CreatedAt"] ?? r["createdAt"] ?? ""),
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/tenants/fields/ apps/web/src/lib/api/customFields.ts
git commit -m "feat(web): custom fields proxy + API client (Plan #13 Task C)"
```

---

### Task D — CustomFieldsAdmin page

**Files:**
- Create: `apps/web/app/(shell)/pm/tenants/fields/page.tsx`

- [ ] **Step 1: Create custom fields admin page**

Create `apps/web/app/(shell)/pm/tenants/fields/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Settings } from "lucide-react";
import { Button, Input, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import {
  listCustomFields, createCustomField, deleteCustomField,
  type CustomFieldDef, type FieldType, type EntityType,
} from "@/lib/api/customFields";

const ENTITY_TYPES: EntityType[] = ["task", "project", "work_order", "item", "document"];
const FIELD_TYPES: FieldType[]   = ["text", "number", "date", "dropdown", "user", "boolean"];

const fieldTypeTone = (t: FieldType) =>
  ({ text: "neutral", number: "info", date: "warning", dropdown: "success", user: "signal", boolean: "neutral" } as const)[t];

export default function CustomFieldsPage() {
  const qc = useQueryClient();
  const [entityType, setEntityType] = useState<EntityType>("task");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fieldKey: "", label: "", fieldType: "text" as FieldType, required: false, options: "" });

  const { data: fields = [], isLoading } = useQuery({
    queryKey: ["custom-fields", entityType],
    queryFn: () => listCustomFields(entityType),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createCustomField({
        entityType,
        fieldKey:  form.fieldKey,
        label:     form.label,
        fieldType: form.fieldType,
        options:   form.fieldType === "dropdown" ? form.options.split(",").map((s) => s.trim()).filter(Boolean) : [],
        required:  form.required,
        sortOrder: fields.length * 10,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom-fields", entityType] });
      setShowForm(false);
      setForm({ fieldKey: "", label: "", fieldType: "text", required: false, options: "" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCustomField(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["custom-fields", entityType] }),
  });

  return (
    <div className="flex flex-col h-full">
      <Breadcrumb items={[
        { label: "PM Hub", href: "/pm/home" },
        { label: "Admin", href: "/pm/tenants" },
        { label: "Custom Fields" },
      ]} />
      <CommandBar
        actions={[
          { label: "Add Field", icon: Plus, onClick: () => setShowForm(true) },
        ]}
      />

      {/* Entity type tabs */}
      <div className="flex gap-1 border-b border-border px-4 py-2">
        {ENTITY_TYPES.map((e) => (
          <button
            key={e}
            onClick={() => setEntityType(e)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors
              ${entityType === e ? "bg-primary text-white" : "bg-surface-2 text-fgMuted hover:text-fg"}`}
          >
            {e.replace("_", " ")}
          </button>
        ))}
      </div>

      {/* Add field form */}
      {showForm && (
        <div className="border-b border-border bg-surface-2 p-4">
          <p className="mb-3 text-sm font-medium">New field for <strong>{entityType}</strong></p>
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="mb-1 block text-xs text-fgMuted">Field Key *</label>
              <Input placeholder="my_field" value={form.fieldKey}
                onChange={(e) => setForm({ ...form, fieldKey: e.target.value })} className="w-36" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-fgMuted">Label *</label>
              <Input placeholder="My Field" value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })} className="w-40" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-fgMuted">Type</label>
              <select
                value={form.fieldType}
                onChange={(e) => setForm({ ...form, fieldType: e.target.value as FieldType })}
                className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
              >
                {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            {form.fieldType === "dropdown" && (
              <div>
                <label className="mb-1 block text-xs text-fgMuted">Options (comma-sep)</label>
                <Input placeholder="A, B, C" value={form.options}
                  onChange={(e) => setForm({ ...form, options: e.target.value })} className="w-48" />
              </div>
            )}
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={form.required}
                  onChange={(e) => setForm({ ...form, required: e.target.checked })} />
                Required
              </label>
              <Button variant="primary" size="sm"
                disabled={!form.fieldKey || !form.label || createMutation.isPending}
                onClick={() => createMutation.mutate()}>
                Save
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Fields table */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-px">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse border-b border-border bg-surface-2" />
            ))}
          </div>
        ) : fields.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-fgMuted">
            <Settings size={32} />
            <p className="text-sm">No custom fields for {entityType} yet.</p>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(true)}>
              <Plus size={14} className="mr-1" /> Add Field
            </Button>
          </div>
        ) : (
          <>
            <div className="flex border-b border-border bg-surface-2 px-4 py-1.5 text-xs font-medium text-fgMuted">
              <span className="w-40">Key</span>
              <span className="flex-1">Label</span>
              <span className="w-24">Type</span>
              <span className="w-20">Required</span>
              <span className="w-12" />
            </div>
            {fields.map((f) => (
              <div key={f.id} className="flex items-center border-b border-border px-4 py-2 text-sm hover:bg-surface-2">
                <span className="w-40 font-mono text-xs text-fgMuted">{f.fieldKey}</span>
                <span className="flex-1">{f.label}</span>
                <span className="w-24">
                  <Tag tone={fieldTypeTone(f.fieldType)} size="sm">{f.fieldType}</Tag>
                </span>
                <span className="w-20 text-xs text-fgMuted">{f.required ? "Yes" : "No"}</span>
                <div className="w-12 flex justify-end">
                  <Button size="sm" variant="ghost" tone="danger"
                    onClick={() => deleteMutation.mutate(f.id)}
                    disabled={deleteMutation.isPending}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add to nav**

In `apps/web/src/lib/mock/apps.ts`, in the PM hub admin group, add:

```typescript
{ id: "custom-fields", name: "Custom Fields", href: "/pm/tenants/fields", icon: "settings" },
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter web typecheck 2>&1 | grep "error TS" | head -20
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/
git commit -m "feat(web): Custom Fields admin page (Plan #13 Task D)"
```

---

### Task E — BI Dashboard Builder

**Files:**
- Create: `apps/web/app/(shell)/pm/reports/dashboard/page.tsx`
- Create: `apps/web/src/components/DashboardBuilder.tsx`

- [ ] **Step 1: Install react-grid-layout**

```bash
cd apps/web && pnpm add react-grid-layout && pnpm add -D @types/react-grid-layout
```

- [ ] **Step 2: Create DashboardBuilder component**

Create `apps/web/src/components/DashboardBuilder.tsx`:

```tsx
"use client";

import { useState, useCallback } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { X, BarChart3, TrendingUp, Table, Hash } from "lucide-react";
import { Button } from "@pmplatform/ui-kit";

export type WidgetType = "kpi" | "bar" | "line" | "table";

export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  dataKey: string;
  value?: string | number;
}

interface Props {
  widgets: Widget[];
  onWidgetsChange: (widgets: Widget[]) => void;
}

const WIDGET_ICONS: Record<WidgetType, React.ComponentType<{ size?: number }>> = {
  kpi:   Hash,
  bar:   BarChart3,
  line:  TrendingUp,
  table: Table,
};

function WidgetCard({ widget, onRemove }: { widget: Widget; onRemove: () => void }) {
  const Icon = WIDGET_ICONS[widget.type];
  return (
    <div className="flex h-full flex-col rounded-md border border-border bg-surface shadow-sm overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-fgMuted" />
          <span className="text-xs font-medium">{widget.title}</span>
        </div>
        <button onClick={onRemove} className="text-fgMuted hover:text-danger">
          <X size={13} />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center p-3">
        {widget.type === "kpi" ? (
          <div className="text-center">
            <p className="font-mono text-3xl font-bold text-primary">{widget.value ?? "—"}</p>
            <p className="mt-1 text-xs text-fgMuted">{widget.dataKey}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-fgMuted">
            <Icon size={24} />
            <p className="text-xs">Connect data source</p>
          </div>
        )}
      </div>
    </div>
  );
}

const WIDGET_PRESETS: Array<{ type: WidgetType; title: string; dataKey: string }> = [
  { type: "kpi",   title: "Open Tasks",       dataKey: "tasks.open"       },
  { type: "kpi",   title: "In Progress",      dataKey: "tasks.inProgress" },
  { type: "bar",   title: "Tasks by Sprint",  dataKey: "sprints.tasks"    },
  { type: "line",  title: "Burndown",         dataKey: "sprint.burndown"  },
  { type: "table", title: "Recent Tasks",     dataKey: "tasks.recent"     },
];

export function DashboardBuilder({ widgets, onWidgetsChange }: Props) {
  const [layout, setLayout] = useState<Layout[]>(() =>
    widgets.map((w, i) => ({ i: w.id, x: (i % 3) * 4, y: Math.floor(i / 3) * 4, w: 4, h: 4 }))
  );

  const addWidget = useCallback((preset: typeof WIDGET_PRESETS[0]) => {
    const id = `widget-${Date.now()}`;
    const newWidget: Widget = { id, ...preset, value: preset.type === "kpi" ? Math.floor(Math.random() * 50) : undefined };
    const col = widgets.length % 3;
    const row = Math.floor(widgets.length / 3);
    setLayout((prev) => [...prev, { i: id, x: col * 4, y: row * 4, w: 4, h: 4 }]);
    onWidgetsChange([...widgets, newWidget]);
  }, [widgets, onWidgetsChange]);

  const removeWidget = useCallback((id: string) => {
    setLayout((prev) => prev.filter((l) => l.i !== id));
    onWidgetsChange(widgets.filter((w) => w.id !== id));
  }, [widgets, onWidgetsChange]);

  return (
    <div className="flex flex-col gap-4">
      {/* Widget palette */}
      <div className="flex flex-wrap gap-2 rounded-md border border-border bg-surface-2 p-3">
        <span className="self-center text-xs font-medium text-fgMuted mr-2">Add widget:</span>
        {WIDGET_PRESETS.map((p) => {
          const Icon = WIDGET_ICONS[p.type];
          return (
            <Button key={p.dataKey} size="sm" variant="ghost" onClick={() => addWidget(p)}>
              <Icon size={13} className="mr-1" />
              {p.title}
            </Button>
          );
        })}
      </div>

      {/* Grid */}
      {widgets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-16 text-fgMuted">
          <BarChart3 size={32} />
          <p className="text-sm">Add widgets from the palette above</p>
        </div>
      ) : (
        <GridLayout
          className="layout"
          layout={layout}
          cols={12}
          rowHeight={60}
          width={960}
          onLayoutChange={setLayout}
          draggableHandle=".widget-drag-handle"
        >
          {widgets.map((w) => (
            <div key={w.id} className="widget-drag-handle cursor-move">
              <WidgetCard widget={w} onRemove={() => removeWidget(w.id)} />
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create Dashboard page**

Create `apps/web/app/(shell)/pm/reports/dashboard/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Save, RefreshCw } from "lucide-react";
import { Button } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { DashboardBuilder, type Widget } from "@/components/DashboardBuilder";

const DEFAULT_WIDGETS: Widget[] = [
  { id: "w1", type: "kpi", title: "Open Tasks",  dataKey: "tasks.open",       value: 24 },
  { id: "w2", type: "kpi", title: "In Progress", dataKey: "tasks.inProgress", value: 8  },
  { id: "w3", type: "kpi", title: "Done Today",  dataKey: "tasks.doneToday",  value: 3  },
];

const STORAGE_KEY = "pm-dashboard-widgets";

function loadWidgets(): Widget[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_WIDGETS;
  } catch {
    return DEFAULT_WIDGETS;
  }
}

export default function DashboardPage() {
  const [widgets, setWidgets] = useState<Widget[]>(loadWidgets);

  function saveWidgets(ws: Widget[]) {
    setWidgets(ws);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
  }

  return (
    <div className="flex flex-col h-full">
      <Breadcrumb items={[
        { label: "PM Hub", href: "/pm/home" },
        { label: "Reports", href: "/pm/reports" },
        { label: "Dashboard Builder" },
      ]} />
      <CommandBar
        actions={[
          { label: "Save Layout", icon: Save, onClick: () => localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets)) },
          { label: "Reset",       icon: RefreshCw, onClick: () => saveWidgets(DEFAULT_WIDGETS) },
        ]}
      />

      <div className="flex-1 overflow-auto p-4">
        <DashboardBuilder widgets={widgets} onWidgetsChange={saveWidgets} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add to PM nav**

In `apps/web/src/lib/mock/apps.ts`, in the PM hub reports/analytics group, add:

```typescript
{ id: "dashboard-builder", name: "Dashboard Builder", href: "/pm/reports/dashboard", icon: "dashboard" },
```

- [ ] **Step 5: Typecheck + build**

```bash
pnpm --filter web typecheck 2>&1 | grep "error TS" | head -20
pnpm --filter web build 2>&1 | tail -10
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/
git commit -m "feat(web): BI Dashboard Builder + Custom Fields admin UI (Plan #13 Task E)"
```

---

### Task F — Final commit

- [ ] **Step 1: Start dev server and verify both pages**

```bash
pnpm --filter web dev
```

Navigate to:
- `/pm/reports/dashboard` — verify grid renders, widgets can be added/removed, layout persists on reload
- `/pm/tenants/fields` — verify entity type tabs work, can add/delete fields (requires tenant-svc running)

- [ ] **Step 2: Final commit**

```bash
git add .
git commit -m "feat(platform): Plan #13 complete — BI Builder + Custom Fields UI"
```
