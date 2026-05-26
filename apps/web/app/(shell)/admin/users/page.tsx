"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button, Input, Tag } from "@pmplatform/ui-kit";
import { listIdentityUsers, type IdentityUser } from "@/lib/api/identity";

const ROLE_LABELS: Record<string, string> = {
  "platform-admin":   "Platform Admin",
  "tenant-admin":     "Tenant Admin",
  "project-manager":  "Project Manager",
  "mfg-operator":     "MFG Operator",
  "quality-engineer": "Quality Engineer",
  "workflow-author":  "Workflow Author",
  "bi-author":        "BI Author",
};

type Tone = "neutral" | "accent" | "info" | "warning" | "success";

function roleTone(role: string): Tone {
  if (role === "platform-admin") return "warning";
  if (role === "tenant-admin")   return "accent";
  return "info";
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<IdentityUser[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    listIdentityUsers()
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = users.filter((u) =>
    !search ||
    u.email?.toLowerCase().includes(search.toLowerCase()) ||
    u.display_name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "Users" }]} />
      <h1 className="text-xl font-semibold">Users</h1>

      <div className="flex gap-2">
        <Input
          placeholder="Search users…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
      </div>

      {loading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface text-ink-3">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Display Name</th>
                <th className="px-4 py-2 text-left font-medium">Email</th>
                <th className="px-4 py-2 text-left font-medium">Role</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-ink-3">No users found.</td>
                </tr>
              ) : filtered.map((u) => (
                <tr key={u.id} className="hover:bg-surface/50">
                  <td className="px-4 py-2 font-medium">{u.display_name || "—"}</td>
                  <td className="px-4 py-2 text-ink-3">{u.email}</td>
                  <td className="px-4 py-2">
                    <Tag tone={roleTone(u.role ?? "")} size="sm">
                      {ROLE_LABELS[u.role ?? ""] ?? (u.role || "—")}
                    </Tag>
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
