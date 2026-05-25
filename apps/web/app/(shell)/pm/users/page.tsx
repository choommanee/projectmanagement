"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import { UserPlus, RefreshCw } from "lucide-react";

const ROLES = [
  "tenant-admin",
  "project-manager",
  "mfg-operator",
  "quality-engineer",
  "workflow-author",
  "bi-author",
  "dashboard-viewer",
  "dashboard-editor",
];

function roleTone(r: string): "neutral" | "info" | "accent" | "success" | "warning" | "danger" | "signal" {
  if (r === "tenant-admin") return "danger";
  if (r === "project-manager") return "info";
  if (r === "mfg-operator") return "accent";
  if (r === "quality-engineer") return "success";
  if (r === "workflow-author") return "warning";
  return "neutral";
}

interface AppUser {
  id: string;
  email: string;
  displayName: string;
  status: string;
  roles: string[];
  createdAt: string;
}

function normUser(r: Record<string, unknown>): AppUser {
  const roles = (r.roles ?? r.Roles ?? []) as string[];
  return {
    id: (r.id ?? r.ID ?? "") as string,
    email: (r.email ?? r.Email ?? "") as string,
    displayName: (r.display_name ?? r.DisplayName ?? r.email ?? r.Email ?? "") as string,
    status: (r.status ?? r.Status ?? "active") as string,
    roles: Array.isArray(roles) ? roles : [],
    createdAt: (r.created_at ?? r.CreatedAt ?? "") as string,
  };
}

async function listUsers(q?: string): Promise<AppUser[]> {
  const url = `/api/identity/users${q ? `?q=${encodeURIComponent(q)}` : ""}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`listUsers failed: ${res.status}`);
  const data = await res.json() as { users?: unknown[] };
  return (data.users ?? []).map(u => normUser(u as Record<string, unknown>));
}

async function inviteUser(payload: { email: string; display_name: string; password: string; roles: string[] }): Promise<AppUser> {
  const res = await fetch("/api/identity/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const e = await res.json() as { error?: string };
    throw new Error(e.error ?? `invite failed: ${res.status}`);
  }
  return normUser(await res.json() as Record<string, unknown>);
}

async function updateUser(id: string, patch: { display_name?: string; roles?: string[] }): Promise<void> {
  const res = await fetch(`/api/identity/users/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const e = await res.json() as { error?: string };
    throw new Error(e.error ?? `update failed: ${res.status}`);
  }
}

async function deactivateUser(id: string): Promise<void> {
  const res = await fetch(`/api/identity/users/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`deactivate failed: ${res.status}`);
}

function InviteDialog({ onClose, onInvited }: { onClose: () => void; onInvited: (u: AppUser) => void }) {
  const [form, setForm] = useState({ email: "", display_name: "", password: "", roles: [] as string[] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleRole(r: string) {
    setForm(f => ({
      ...f,
      roles: f.roles.includes(r) ? f.roles.filter(x => x !== r) : [...f.roles, r],
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email || !form.password) return;
    setLoading(true); setError(null);
    try {
      const u = await inviteUser(form);
      onInvited(u);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <form onSubmit={submit} className="bg-background border-2 border-border w-full max-w-md p-6 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest">Invite User</h2>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Email *</label>
          <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="alice@example.com" required />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Display Name</label>
          <Input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} placeholder="Alice Smith" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Temporary Password *</label>
          <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Min 8 chars" required />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Roles</label>
          <div className="flex flex-wrap gap-1.5">
            {ROLES.map(r => (
              <button
                key={r}
                type="button"
                onClick={() => toggleRole(r)}
                className={`px-2 py-0.5 text-xs border font-mono transition-colors ${form.roles.includes(r) ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground"}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2 justify-end pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={loading}>{loading ? "Inviting…" : "Invite"}</Button>
        </div>
      </form>
    </div>
  );
}

function EditRolesDialog({ user, onClose, onSaved }: { user: AppUser; onClose: () => void; onSaved: (roles: string[]) => void }) {
  const [roles, setRoles] = useState<string[]>(user.roles);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleRole(r: string) {
    setRoles(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  }

  async function save() {
    setLoading(true); setError(null);
    try {
      await updateUser(user.id, { roles });
      onSaved(roles);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border-2 border-border w-full max-w-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest">Edit Roles — {user.email}</h2>
        <div className="flex flex-wrap gap-1.5">
          {ROLES.map(r => (
            <button
              key={r}
              type="button"
              onClick={() => toggleRole(r)}
              className={`px-2 py-0.5 text-xs border font-mono transition-colors ${roles.includes(r) ? "bg-foreground text-background border-foreground" : "border-border text-muted-foreground hover:border-foreground"}`}
            >
              {r}
            </button>
          ))}
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2 justify-end pt-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={loading} onClick={save}>{loading ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q?: string) => {
    setLoading(true); setError(null);
    try {
      setUsers(await listUsers(q));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleDeactivate(u: AppUser) {
    if (!confirm(`Deactivate ${u.email}?`)) return;
    try {
      await deactivateUser(u.id);
      setUsers(prev => prev.filter(x => x.id !== u.id));
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const displayed = search
    ? users.filter(u => u.email.includes(search) || u.displayName.toLowerCase().includes(search.toLowerCase()))
    : users;

  return (
    <div className="flex flex-col h-full">
      <Breadcrumb items={[{ label: "Users" }]} />
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by email or name…"
          className="w-64"
        />
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => load()}>
          <RefreshCw size={14} />
        </Button>
        <Button size="sm" onClick={() => setShowInvite(true)}>
          <UserPlus size={14} className="mr-1" />
          Invite User
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-border">
              <th className="text-left py-2 px-3 text-xs uppercase tracking-widest font-semibold">User</th>
              <th className="text-left py-2 px-3 text-xs uppercase tracking-widest font-semibold">Roles</th>
              <th className="text-left py-2 px-3 text-xs uppercase tracking-widest font-semibold">Status</th>
              <th className="text-left py-2 px-3 text-xs uppercase tracking-widest font-semibold">Joined</th>
              <th className="py-2 px-3" />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted-foreground text-xs">Loading…</td>
              </tr>
            )}
            {!loading && displayed.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-muted-foreground text-xs">No users found</td>
              </tr>
            )}
            {displayed.map(u => (
              <tr key={u.id} className="border-b border-border hover:bg-muted/30 transition-colors">
                <td className="py-2 px-3">
                  <div className="font-medium">{u.displayName}</div>
                  <div className="text-xs text-muted-foreground font-mono">{u.email}</div>
                </td>
                <td className="py-2 px-3">
                  <div className="flex flex-wrap gap-1">
                    {u.roles.length === 0
                      ? <span className="text-xs text-muted-foreground">—</span>
                      : u.roles.map(r => <Tag key={r} tone={roleTone(r)} size="sm">{r}</Tag>)
                    }
                  </div>
                </td>
                <td className="py-2 px-3">
                  <Tag
                    tone={u.status === "active" ? "success" : u.status === "invited" ? "warning" : "neutral"}
                    size="sm"
                  >
                    {u.status}
                  </Tag>
                </td>
                <td className="py-2 px-3 font-mono text-xs text-muted-foreground">
                  {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                </td>
                <td className="py-2 px-3">
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setEditUser(u)}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Edit roles
                    </button>
                    <button
                      onClick={() => handleDeactivate(u)}
                      className="text-xs text-red-500 hover:text-red-700 transition-colors"
                    >
                      Deactivate
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showInvite && (
        <InviteDialog
          onClose={() => setShowInvite(false)}
          onInvited={u => { setUsers(prev => [u, ...prev]); setShowInvite(false); }}
        />
      )}
      {editUser && (
        <EditRolesDialog
          user={editUser}
          onClose={() => setEditUser(null)}
          onSaved={roles => {
            setUsers(prev => prev.map(u => u.id === editUser.id ? { ...u, roles } : u));
            setEditUser(null);
          }}
        />
      )}
    </div>
  );
}
