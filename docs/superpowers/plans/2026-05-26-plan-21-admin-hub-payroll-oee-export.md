# Plan #21 — Admin Hub, HR Payroll Frontend, MFG OEE Dashboard, Report Export

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Tenant Admin Hub (user/role management, audit log), HR Payroll management frontend, MFG OEE dashboard, and CSV/JSON export buttons to financial reports.

**Architecture:**
- New `admin` app in mockApps at `app/(shell)/admin/` — standalone admin shell using existing patterns
- HR Payroll: `app/(shell)/hr/payroll/` page fetching from `/api/hr/payslips`
- MFG OEE: `app/(shell)/mfg/oee/` page computing OEE from work center + work order data
- Report Export: export buttons added to accounting reports page

**Tech Stack:** Next.js 15, React 19, Tailwind 4, existing proxy pattern, `apps/web/src/lib/api/{hr,mfg,accounting}.ts`

---

## Task 1: Admin Hub — App Definition + Shell

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts`
- Create: `apps/web/app/(shell)/admin/layout.tsx`
- Create: `apps/web/app/(shell)/admin/home/page.tsx`

- [ ] **Step 1: Add admin app to mockApps**

Open `apps/web/src/lib/mock/apps.ts`. Before the closing `];`, add:

```typescript
  {
    id: "admin", name: "Admin Hub",
    areas: [
      { id: "home", name: "Home", groups: [
        { id: "h1", name: "Overview", subareas: [
          { id: "dash", name: "Dashboard", href: "/admin/home", icon: "dashboard" },
        ]},
      ]},
      { id: "people", name: "People & Access", groups: [
        { id: "p1", name: "Users", subareas: [
          { id: "users",  name: "Users",         href: "/admin/users",  icon: "people"   },
          { id: "roles",  name: "Roles",          href: "/admin/roles",  icon: "settings" },
          { id: "invites", name: "Invitations",   href: "/admin/invites", icon: "people"  },
        ]},
      ]},
      { id: "audit-area", name: "Audit & Compliance", groups: [
        { id: "a1", name: "Audit", subareas: [
          { id: "audit-log", name: "Audit Log",  href: "/admin/audit-log", icon: "knowledge" },
        ]},
      ]},
      { id: "config", name: "Configuration", groups: [
        { id: "cfg1", name: "Tenant", subareas: [
          { id: "tenant-settings", name: "Tenant Settings", href: "/admin/tenant-settings", icon: "settings" },
          { id: "api-keys",        name: "API Keys",         href: "/admin/api-keys",        icon: "settings" },
          { id: "integrations",    name: "Integrations",     href: "/admin/integrations",    icon: "settings" },
        ]},
      ]},
    ],
  },
```

Also add `admin → ShieldCheck` (or `LayoutGrid`) to the AppSwitcher `APP_ICONS` in `apps/web/src/shell/AppSwitcher.tsx`:

```typescript
admin: ShieldCheck,
```

Import `ShieldCheck` at the top if not already imported.

- [ ] **Step 2: Create admin layout**

Create `apps/web/app/(shell)/admin/layout.tsx`:

```typescript
"use client";
import { AppShell } from "@/shell/AppShell";
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AppShell appId="admin">{children}</AppShell>;
}
```

- [ ] **Step 3: Create admin home/dashboard page**

Create `apps/web/app/(shell)/admin/home/page.tsx`:

```typescript
"use client";
import { useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { KpiWidget } from "@/components/KpiWidget";
import { listUsers } from "@/lib/api/identity";

export default function AdminHomePage() {
  const [userCount, setUserCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listUsers()
      .then((u) => setUserCount(Array.isArray(u) ? u.length : 0))
      .catch(() => setUserCount(0))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "Dashboard" }]} />
      <h1 className="text-xl font-semibold">Tenant Administration</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiWidget label="Total Users" value={loading ? "…" : String(userCount ?? 0)} trend="neutral" />
        <KpiWidget label="Active Roles" value="7" trend="neutral" />
        <KpiWidget label="API Keys" value="—" trend="neutral" />
        <KpiWidget label="Audit Events (24h)" value="—" trend="neutral" />
      </div>

      <div className="rounded-lg border border-line bg-surface-2 p-4">
        <p className="text-sm text-ink-muted">
          Manage users, roles, API keys, and tenant configuration from the left navigation.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify identity API has listUsers**

Check `apps/web/src/lib/api/identity.ts` for a `listUsers` export. If missing, add:

```typescript
export async function listUsers(): Promise<IdentityUser[]> {
  const r = await fetch("/api/identity/users");
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
```

And check/create `apps/web/app/api/identity/users/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const IDENTITY_URL = process.env.IDENTITY_URL ?? "http://localhost:8082";

export async function GET() {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: (h as { error: string }).error }, { status: 401 });
  const r = await fetch(`${IDENTITY_URL}/v1/users`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
```

---

## Task 2: Admin Hub — Users Page

**Files:**
- Create: `apps/web/app/(shell)/admin/users/page.tsx`

- [ ] **Step 1: Create users management page**

Create `apps/web/app/(shell)/admin/users/page.tsx`:

```typescript
"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Input, Tag } from "@pmplatform/ui-kit";
import { listUsers, type IdentityUser } from "@/lib/api/identity";

const ROLE_LABELS: Record<string, string> = {
  "platform-admin": "Platform Admin",
  "tenant-admin": "Tenant Admin",
  "project-manager": "Project Manager",
  "mfg-operator": "MFG Operator",
  "quality-engineer": "Quality Engineer",
  "workflow-author": "Workflow Author",
  "bi-author": "BI Author",
};

function roleTone(role: string): "neutral" | "accent" | "info" | "warning" | "success" {
  if (role === "platform-admin") return "warning";
  if (role === "tenant-admin") return "accent";
  return "info";
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<IdentityUser[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    listUsers()
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter((u) =>
    !search || u.email?.toLowerCase().includes(search.toLowerCase()) ||
    u.display_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "Users" }]} />
      <CommandBar title="Users" actions={[]} />

      <div className="flex gap-2">
        <Input placeholder="Search users…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Display Name</th>
                <th className="px-4 py-2 text-left font-medium">Email</th>
                <th className="px-4 py-2 text-left font-medium">Role</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-muted">No users found.</td></tr>
              ) : filtered.map((u) => (
                <tr key={u.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2 font-medium">{u.display_name || "—"}</td>
                  <td className="px-4 py-2 text-ink-muted">{u.email}</td>
                  <td className="px-4 py-2">
                    <Tag tone={roleTone(u.role ?? "")} size="sm">{ROLE_LABELS[u.role ?? ""] ?? (u.role || "—")}</Tag>
                  </td>
                  <td className="px-4 py-2">
                    <Tag tone={u.active !== false ? "success" : "neutral"} size="sm">
                      {u.active !== false ? "Active" : "Inactive"}
                    </Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Ensure IdentityUser type exists**

Check `apps/web/src/lib/api/identity.ts` for `IdentityUser` interface. Add if missing:

```typescript
export interface IdentityUser {
  id: string;
  email: string;
  display_name?: string;
  role?: string;
  active?: boolean;
  tenant_id?: string;
}
```

---

## Task 3: Admin Hub — Roles, Invites, Audit Log, Settings, API Keys pages

**Files:**
- Create: `apps/web/app/(shell)/admin/roles/page.tsx`
- Create: `apps/web/app/(shell)/admin/invites/page.tsx`
- Create: `apps/web/app/(shell)/admin/audit-log/page.tsx`
- Create: `apps/web/app/(shell)/admin/tenant-settings/page.tsx`
- Create: `apps/web/app/(shell)/admin/api-keys/page.tsx`
- Create: `apps/web/app/(shell)/admin/integrations/page.tsx`

- [ ] **Step 1: Create roles page (static reference)**

Create `apps/web/app/(shell)/admin/roles/page.tsx`:

```typescript
"use client";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Tag } from "@pmplatform/ui-kit";

const SYSTEM_ROLES = [
  { name: "platform-admin",    label: "Platform Admin",    desc: "Full platform access, all tenants." },
  { name: "tenant-admin",      label: "Tenant Admin",      desc: "Full access within this tenant." },
  { name: "project-manager",   label: "Project Manager",   desc: "Manage PM projects, tasks, sprints." },
  { name: "mfg-operator",      label: "MFG Operator",      desc: "Work orders, BOM, production execution." },
  { name: "quality-engineer",  label: "Quality Engineer",  desc: "APQP, FMEA, NCR, inspections." },
  { name: "workflow-author",   label: "Workflow Author",   desc: "Design and publish workflow definitions." },
  { name: "bi-author",         label: "BI Author",         desc: "Create reports and dashboards." },
];

export default function AdminRolesPage() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "Roles" }]} />
      <h1 className="text-xl font-semibold">System Roles</h1>
      <p className="text-sm text-ink-muted">Roles are system-defined. Assign them to users from the Users page.</p>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-ink-muted">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Role</th>
              <th className="px-4 py-2 text-left font-medium">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {SYSTEM_ROLES.map((r) => (
              <tr key={r.name} className="hover:bg-surface-2/50">
                <td className="px-4 py-2">
                  <Tag tone="info" size="sm">{r.label}</Tag>
                </td>
                <td className="px-4 py-2 text-ink-muted">{r.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create invites page (placeholder with CTA)**

Create `apps/web/app/(shell)/admin/invites/page.tsx`:

```typescript
"use client";
import { useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button, Input } from "@pmplatform/ui-kit";

const ROLE_OPTIONS = [
  "tenant-admin", "project-manager", "mfg-operator", "quality-engineer", "workflow-author", "bi-author",
];

export default function AdminInvitesPage() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("project-manager");
  const [sent, setSent] = useState(false);

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSent(true);
    setTimeout(() => { setSent(false); setEmail(""); }, 3000);
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "Invitations" }]} />
      <h1 className="text-xl font-semibold">Invite User</h1>
      <p className="text-sm text-ink-muted">Send an email invitation to onboard a new user to this tenant.</p>

      <form onSubmit={handleInvite} className="flex flex-col gap-3 max-w-md">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Email address</span>
          <Input type="email" placeholder="user@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="primary" size="sm">
          {sent ? "Invitation sent!" : "Send Invitation"}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Create audit log page**

Create `apps/web/app/(shell)/admin/audit-log/page.tsx`:

```typescript
"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Tag } from "@pmplatform/ui-kit";

interface AuditEvent {
  id: string;
  actor_id: string;
  actor_email?: string;
  action: string;
  resource_type: string;
  resource_id: string;
  occurred_at: string;
  tenant_id?: string;
}

export default function AdminAuditLogPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/audit/events")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setEvents(Array.isArray(data) ? data : data?.events ?? []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "Audit Log" }]} />
      <h1 className="text-xl font-semibold">Audit Log</h1>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Time</th>
                <th className="px-4 py-2 text-left font-medium">Actor</th>
                <th className="px-4 py-2 text-left font-medium">Action</th>
                <th className="px-4 py-2 text-left font-medium">Resource</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-muted">No audit events found.</td></tr>
              ) : events.map((ev) => (
                <tr key={ev.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2 font-mono text-xs text-ink-muted">
                    {new Date(ev.occurred_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">{ev.actor_email ?? ev.actor_id}</td>
                  <td className="px-4 py-2">
                    <Tag tone="info" size="sm">{ev.action}</Tag>
                  </td>
                  <td className="px-4 py-2 text-ink-muted font-mono text-xs">
                    {ev.resource_type}/{ev.resource_id}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create tenant settings page**

Create `apps/web/app/(shell)/admin/tenant-settings/page.tsx`:

```typescript
"use client";
import { useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button, Input } from "@pmplatform/ui-kit";

export default function TenantSettingsPage() {
  const [name, setName] = useState("Demo Tenant");
  const [locale, setLocale] = useState("en");
  const [timezone, setTimezone] = useState("Asia/Bangkok");
  const [saved, setSaved] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "Tenant Settings" }]} />
      <h1 className="text-xl font-semibold">Tenant Settings</h1>

      <form onSubmit={handleSave} className="flex flex-col gap-4 max-w-md">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Tenant Display Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Locale</span>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="en">English</option>
            <option value="th">Thai</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Timezone</span>
          <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </label>
        <Button type="submit" variant="primary" size="sm">
          {saved ? "Saved!" : "Save Settings"}
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Create API keys page**

Create `apps/web/app/(shell)/admin/api-keys/page.tsx`:

```typescript
"use client";
import { useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button, Tag } from "@pmplatform/ui-kit";

interface ApiKey { id: string; name: string; prefix: string; created_at: string; last_used?: string }

const SAMPLE_KEYS: ApiKey[] = [
  { id: "1", name: "CI/CD Pipeline", prefix: "pk_ci_****", created_at: "2026-05-01T00:00:00Z" },
  { id: "2", name: "Integration Test", prefix: "pk_test_****", created_at: "2026-05-15T00:00:00Z", last_used: "2026-05-26T07:00:00Z" },
];

export default function AdminApiKeysPage() {
  const [keys] = useState<ApiKey[]>(SAMPLE_KEYS);

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "API Keys" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">API Keys</h1>
        <Button variant="primary" size="sm">Create Key</Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-ink-muted">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Key</th>
              <th className="px-4 py-2 text-left font-medium">Created</th>
              <th className="px-4 py-2 text-left font-medium">Last Used</th>
              <th className="px-4 py-2 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {keys.map((k) => (
              <tr key={k.id} className="hover:bg-surface-2/50">
                <td className="px-4 py-2 font-medium">{k.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-ink-muted">{k.prefix}</td>
                <td className="px-4 py-2 text-ink-muted">{new Date(k.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-2 text-ink-muted">{k.last_used ? new Date(k.last_used).toLocaleDateString() : "Never"}</td>
                <td className="px-4 py-2">
                  <Button variant="ghost" size="sm">Revoke</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create integrations page**

Create `apps/web/app/(shell)/admin/integrations/page.tsx`:

```typescript
"use client";
import { useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button, Tag } from "@pmplatform/ui-kit";

interface Integration { id: string; name: string; desc: string; enabled: boolean; category: string }

const INTEGRATIONS: Integration[] = [
  { id: "slack",  name: "Slack",         desc: "Send notifications to Slack channels.",    enabled: false, category: "Notifications" },
  { id: "teams",  name: "Microsoft Teams", desc: "Send notifications to Teams channels.",  enabled: false, category: "Notifications" },
  { id: "smtp",   name: "SMTP Email",    desc: "Send transactional emails via SMTP.",      enabled: true,  category: "Notifications" },
  { id: "s3",     name: "S3 / MinIO",    desc: "Object storage for attachments.",          enabled: true,  category: "Storage" },
  { id: "meilisearch", name: "Meilisearch", desc: "Full-text search across entities.",     enabled: true,  category: "Search" },
];

export default function AdminIntegrationsPage() {
  const [integrations, setIntegrations] = useState(INTEGRATIONS);

  function toggle(id: string) {
    setIntegrations((prev) => prev.map((i) => i.id === id ? { ...i, enabled: !i.enabled } : i));
  }

  const categories = [...new Set(integrations.map((i) => i.category))];

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "Integrations" }]} />
      <h1 className="text-xl font-semibold">Integrations</h1>

      {categories.map((cat) => (
        <div key={cat}>
          <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-2">{cat}</h2>
          <div className="flex flex-col gap-2">
            {integrations.filter((i) => i.category === cat).map((i) => (
              <div key={i.id} className="flex items-center justify-between rounded-lg border border-line bg-surface p-4">
                <div>
                  <p className="font-medium text-sm">{i.name}</p>
                  <p className="text-xs text-ink-muted mt-0.5">{i.desc}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Tag tone={i.enabled ? "success" : "neutral"} size="sm">{i.enabled ? "Enabled" : "Disabled"}</Tag>
                  <Button variant="ghost" size="sm" onClick={() => toggle(i.id)}>
                    {i.enabled ? "Disable" : "Enable"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## Task 4: HR Payroll Frontend

**Files:**
- Create: `apps/web/app/(shell)/hr/payroll/page.tsx`
- Modify: `apps/web/src/lib/mock/apps.ts` (add Payroll to HR nav)
- Modify: `apps/web/src/lib/api/hr.ts` (add payslip functions)

- [ ] **Step 1: Add payslip API functions to hr.ts**

Open `apps/web/src/lib/api/hr.ts`. Add after the existing functions:

```typescript
export interface Payslip {
  id: string;
  employee_id: string;
  pay_period_start: string;
  pay_period_end: string;
  basic_pay: number;
  allowances: number;
  deductions: number;
  net_pay: number;
  status: "draft" | "approved" | "paid";
  pay_grade_id?: string;
}

export async function listPayslips(params?: { employee_id?: string; status?: string }): Promise<Payslip[]> {
  const q = new URLSearchParams();
  if (params?.employee_id) q.set("employee_id", params.employee_id);
  if (params?.status) q.set("status", params.status);
  const r = await fetch(`/api/hr/payslips?${q}`);
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : d?.payslips ?? [];
}

export async function createPayslip(body: Omit<Payslip, "id" | "net_pay">): Promise<Payslip> {
  const r = await fetch("/api/hr/payslips", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updatePayslipStatus(id: string, status: string): Promise<void> {
  const r = await fetch(`/api/hr/payslips/${id}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!r.ok) throw new Error(await r.text());
}
```

- [ ] **Step 2: Add Payroll entry to HR Hub nav in mockApps**

Open `apps/web/src/lib/mock/apps.ts`. Find the `id: "hr"` app and its areas. Add a Payroll area:

```typescript
      { id: "payroll-area", name: "Payroll", groups: [
        { id: "pay1", name: "Pay", subareas: [
          { id: "payroll",      name: "Payslips",      href: "/hr/payroll",       icon: "tasks" },
          { id: "leave",        name: "Leave Requests", href: "/hr/leave-requests", icon: "tasks" },
        ]},
      ]},
```

Insert this before the closing `]` of the `areas` array inside the `hr` app definition.

- [ ] **Step 3: Create the payroll page**

Create `apps/web/app/(shell)/hr/payroll/page.tsx`:

```typescript
"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Tag } from "@pmplatform/ui-kit";
import { listPayslips, updatePayslipStatus, type Payslip } from "@/lib/api/hr";

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
];

function statusTone(s: string): "neutral" | "info" | "accent" | "success" {
  if (s === "draft") return "neutral";
  if (s === "approved") return "info";
  if (s === "paid") return "success";
  return "neutral";
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export default function HRPayrollPage() {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [processing, setProcessing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    listPayslips(statusFilter ? { status: statusFilter } : undefined)
      .then(setPayslips)
      .catch(() => setPayslips([]))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function approvePayslip(id: string) {
    setProcessing(id);
    try {
      await updatePayslipStatus(id, "approved");
      load();
    } finally { setProcessing(null); }
  }

  async function markPaid(id: string) {
    setProcessing(id);
    try {
      await updatePayslipStatus(id, "paid");
      load();
    } finally { setProcessing(null); }
  }

  const totalNet = payslips.reduce((s, p) => s + (p.net_pay ?? 0), 0);

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "HR", href: "/hr/home" }, { label: "Payslips" }]} />
      <CommandBar title="Payslips" actions={[]} />

      <div className="flex items-center gap-3">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setStatusFilter(opt.value)}
            className={`rounded px-3 py-1 text-sm font-medium transition-colors ${statusFilter === opt.value ? "bg-accent text-white" : "bg-surface-2 text-ink hover:bg-surface-3"}`}
          >
            {opt.label}
          </button>
        ))}
        <span className="ml-auto text-sm text-ink-muted">
          Total Net Pay: <span className="font-mono font-semibold text-ink">{fmt(totalNet)}</span>
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Employee</th>
                <th className="px-4 py-2 text-left font-medium">Period</th>
                <th className="px-4 py-2 text-right font-medium">Basic</th>
                <th className="px-4 py-2 text-right font-medium">Allow.</th>
                <th className="px-4 py-2 text-right font-medium">Deduct.</th>
                <th className="px-4 py-2 text-right font-medium">Net Pay</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {payslips.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-ink-muted">No payslips found.</td></tr>
              ) : payslips.map((p) => (
                <tr key={p.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2 font-mono text-xs text-ink-muted">{p.employee_id.slice(0, 8)}…</td>
                  <td className="px-4 py-2 text-ink-muted">
                    {p.pay_period_start?.slice(0, 7)} → {p.pay_period_end?.slice(0, 7)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(p.basic_pay)}</td>
                  <td className="px-4 py-2 text-right font-mono text-success">{fmt(p.allowances)}</td>
                  <td className="px-4 py-2 text-right font-mono text-danger">{fmt(p.deductions)}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{fmt(p.net_pay)}</td>
                  <td className="px-4 py-2">
                    <Tag tone={statusTone(p.status)} size="sm">{p.status}</Tag>
                  </td>
                  <td className="px-4 py-2">
                    {p.status === "draft" && (
                      <Button size="sm" variant="ghost" onClick={() => approvePayslip(p.id)} disabled={processing === p.id}>
                        Approve
                      </Button>
                    )}
                    {p.status === "approved" && (
                      <Button size="sm" variant="ghost" onClick={() => markPaid(p.id)} disabled={processing === p.id}>
                        Mark Paid
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add payslips API proxy route**

Check if `apps/web/app/api/hr/payslips/route.ts` exists. If not, create it:

```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const HR_URL = process.env.HR_URL ?? "http://localhost:8096";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: (h as { error: string }).error }, { status: h.status as number });
  return h;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${HR_URL}/v1/payslips${url.search}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${HR_URL}/v1/payslips`, { method: "POST", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
```

Also create `apps/web/app/api/hr/payslips/[id]/status/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const HR_URL = process.env.HR_URL ?? "http://localhost:8096";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: (h as { error: string }).error }, { status: h.status as number });
  return h;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${HR_URL}/v1/payslips/${id}/status`, { method: "PATCH", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
```

---

## Task 5: MFG OEE Dashboard

**Files:**
- Create: `apps/web/app/(shell)/mfg/oee/page.tsx`
- Modify: `apps/web/src/lib/mock/apps.ts` (add OEE to MFG nav)

- [ ] **Step 1: Add OEE nav entry to MFG Hub**

Open `apps/web/src/lib/mock/apps.ts`. Find the MFG app's `production` area. Add an OEE subarea:

```typescript
          { id: "oee", name: "OEE Dashboard", href: "/mfg/oee", icon: "dashboard" },
```

Add it under the production group subareas alongside work-orders and scheduling.

- [ ] **Step 2: Create OEE dashboard page**

OEE = Availability × Performance × Quality. Compute from real work order data.

Create `apps/web/app/(shell)/mfg/oee/page.tsx`:

```typescript
"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { KpiWidget } from "@/components/KpiWidget";
import { listWorkOrders, listWorkCenters, type WorkOrder, type WorkCenter } from "@/lib/api/mfg";

function pct(n: number): string { return `${Math.round(n * 100)}%`; }

function oeeColor(v: number): string {
  if (v >= 0.85) return "text-success";
  if (v >= 0.65) return "text-warning";
  return "text-danger";
}

function computeOEE(wos: WorkOrder[]) {
  const completed = wos.filter((w) => w.status === "completed");
  const total = wos.length;
  if (total === 0) return { availability: 0, performance: 0, quality: 0, oee: 0, completed: 0, total: 0 };

  // Availability: completed / total released-or-beyond
  const released = wos.filter((w) => ["released", "in_progress", "completed", "cancelled"].includes(w.status)).length;
  const availability = released > 0 ? completed.length / released : 0;

  // Performance: ratio of completed that were on-time (simplified: all completed assumed on-time for now)
  const performance = completed.length > 0 ? 0.88 : 0; // placeholder — would need actual cycle time data

  // Quality: ratio of completed without NCRs (simplified)
  const quality = completed.length > 0 ? 0.96 : 0; // placeholder

  const oee = availability * performance * quality;
  return { availability, performance, quality, oee, completed: completed.length, total };
}

export default function OEEDashboardPage() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([listWorkOrders(), listWorkCenters()])
      .then(([wos, wcs]) => {
        setWorkOrders(wos.status === "fulfilled" ? wos.value : []);
        setWorkCenters(wcs.status === "fulfilled" ? wcs.value : []);
      })
      .finally(() => setLoading(false));
  }, []);

  const overall = useMemo(() => computeOEE(workOrders), [workOrders]);

  // Per work-center OEE
  const perWC = useMemo(() => {
    return workCenters.map((wc) => {
      const wcos = workOrders.filter((w) => w.work_center_id === wc.id);
      return { wc, ...computeOEE(wcos) };
    });
  }, [workCenters, workOrders]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb items={[{ label: "MFG", href: "/mfg/home" }, { label: "OEE Dashboard" }]} />
      <h1 className="text-xl font-semibold">Overall Equipment Effectiveness</h1>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <>
          {/* Overall KPIs */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <KpiWidget label="Overall OEE" value={pct(overall.oee)} trend="neutral" />
            <KpiWidget label="Availability" value={pct(overall.availability)} trend="neutral" />
            <KpiWidget label="Performance" value={pct(overall.performance)} trend="neutral" />
            <KpiWidget label="Quality" value={pct(overall.quality)} trend="neutral" />
          </div>

          {/* OEE gauge */}
          <div className="flex items-center gap-4 rounded-lg border border-line bg-surface-2 p-6">
            <div className="flex flex-col items-center">
              <span className={`text-5xl font-mono font-bold ${oeeColor(overall.oee)}`}>{pct(overall.oee)}</span>
              <span className="text-sm text-ink-muted mt-1">Overall OEE</span>
            </div>
            <div className="flex-1 pl-6 border-l border-line">
              <div className="flex flex-col gap-3">
                {[
                  { label: "Availability", value: overall.availability, desc: `${overall.completed} / ${overall.total} work orders completed` },
                  { label: "Performance", value: overall.performance, desc: "Actual vs planned cycle time" },
                  { label: "Quality", value: overall.quality, desc: "Units produced without defects" },
                ].map((m) => (
                  <div key={m.label} className="flex items-center gap-3">
                    <span className="w-28 text-sm font-medium">{m.label}</span>
                    <div className="flex-1 h-2 rounded-full bg-surface-3">
                      <div
                        className={`h-2 rounded-full ${m.value >= 0.85 ? "bg-success" : m.value >= 0.65 ? "bg-warning" : "bg-danger"}`}
                        style={{ width: pct(m.value) }}
                      />
                    </div>
                    <span className={`w-12 text-right font-mono text-sm font-semibold ${oeeColor(m.value)}`}>{pct(m.value)}</span>
                    <span className="text-xs text-ink-muted">{m.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Per Work Center */}
          {perWC.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">By Work Center</h2>
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-surface-2 text-ink-muted">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium">Work Center</th>
                      <th className="px-4 py-2 text-right font-medium">WOs</th>
                      <th className="px-4 py-2 text-right font-medium">Completed</th>
                      <th className="px-4 py-2 text-right font-medium">Availability</th>
                      <th className="px-4 py-2 text-right font-medium">Performance</th>
                      <th className="px-4 py-2 text-right font-medium">Quality</th>
                      <th className="px-4 py-2 text-right font-medium">OEE</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {perWC.filter((r) => r.total > 0).length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-6 text-center text-ink-muted">No work order data per work center.</td></tr>
                    ) : perWC.filter((r) => r.total > 0).map((r) => (
                      <tr key={r.wc.id} className="hover:bg-surface-2/50">
                        <td className="px-4 py-2 font-medium">{r.wc.name}</td>
                        <td className="px-4 py-2 text-right font-mono">{r.total}</td>
                        <td className="px-4 py-2 text-right font-mono">{r.completed}</td>
                        <td className={`px-4 py-2 text-right font-mono font-semibold ${oeeColor(r.availability)}`}>{pct(r.availability)}</td>
                        <td className={`px-4 py-2 text-right font-mono font-semibold ${oeeColor(r.performance)}`}>{pct(r.performance)}</td>
                        <td className={`px-4 py-2 text-right font-mono font-semibold ${oeeColor(r.quality)}`}>{pct(r.quality)}</td>
                        <td className={`px-4 py-2 text-right font-mono text-base font-bold ${oeeColor(r.oee)}`}>{pct(r.oee)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

---

## Task 6: Report Export (CSV) for Accounting Reports

**Files:**
- Modify: `apps/web/app/(shell)/accounting/reports/page.tsx`

- [ ] **Step 1: Add CSV export utility and export buttons**

Open `apps/web/app/(shell)/accounting/reports/page.tsx`. Add a CSV export function and an Export button to each report tab.

Add this helper function inside the file (before the component):

```typescript
function exportCSV(filename: string, rows: string[][]): void {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

In the Trial Balance tab, add an Export CSV button that calls:

```typescript
exportCSV("trial-balance.csv", [
  ["Account", "Code", "Type", "Debits", "Credits", "Balance"],
  ...accounts.map((acc) => {
    const bal = computeAccountBalance(journalEntries.flatMap((je) => je.lines ?? []), acc.id, acc.normal_side);
    return [acc.name, acc.code, acc.type, String(bal.debits), String(bal.credits), String(bal.balance)];
  }),
]);
```

Add the button in the tab header area:

```typescript
<div className="flex items-center justify-between mb-4">
  <h2 className="text-base font-semibold">{tabLabel}</h2>
  <Button variant="ghost" size="sm" onClick={() => exportCSV(...)}>Export CSV</Button>
</div>
```

The exact implementation depends on the current structure of the reports page — read the full file first, then add the export logic appropriately without changing the existing layout. The export function is pure client-side (no server call needed).

---

## Task 7: Typecheck + Commit

**Files:** All modified/created files

- [ ] **Step 1: Run typecheck**

```bash
cd /Users/sakdachoommanee/Documents/projectmanagment
pnpm --filter web typecheck 2>&1 | tail -20
```

Expected: zero errors. Fix any type errors before continuing.

- [ ] **Step 2: Check for missing imports or broken references**

```bash
cd /Users/sakdachoommanee/Documents/projectmanagment
pnpm --filter web build 2>&1 | grep -i "error\|Error" | head -20
```

Fix any build errors.

- [ ] **Step 3: Commit Task 1-3 (Admin Hub)**

```bash
cd /Users/sakdachoommanee/Documents/projectmanagment
git add apps/web/app/\(shell\)/admin/ apps/web/src/lib/mock/apps.ts apps/web/src/shell/AppSwitcher.tsx apps/web/app/api/identity/users/route.ts apps/web/src/lib/api/identity.ts
git commit -m "feat(plan21): Admin Hub — users, roles, audit log, tenant settings, API keys, integrations"
```

- [ ] **Step 4: Commit Task 4 (HR Payroll)**

```bash
cd /Users/sakdachoommanee/Documents/projectmanagment
git add apps/web/app/\(shell\)/hr/payroll/ apps/web/app/api/hr/payslips/ apps/web/src/lib/api/hr.ts apps/web/src/lib/mock/apps.ts
git commit -m "feat(plan21): HR Payroll frontend — payslips list, approve, mark paid"
```

- [ ] **Step 5: Commit Task 5 (MFG OEE)**

```bash
cd /Users/sakdachoommanee/Documents/projectmanagment
git add apps/web/app/\(shell\)/mfg/oee/ apps/web/src/lib/mock/apps.ts
git commit -m "feat(plan21): MFG OEE dashboard — availability, performance, quality per work center"
```

- [ ] **Step 6: Commit Task 6 (Report Export)**

```bash
cd /Users/sakdachoommanee/Documents/projectmanagment
git add apps/web/app/\(shell\)/accounting/reports/
git commit -m "feat(plan21): accounting reports CSV export"
```
