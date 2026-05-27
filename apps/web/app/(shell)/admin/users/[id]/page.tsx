"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getIdentityUser, type IdentityUser } from "@/lib/api/identity";

export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [user, setUser] = useState<IdentityUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getIdentityUser(id).then(setUser).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-ink-3">Loading...</div>;
  if (!user) return <div className="p-8 text-destructive">User not found.</div>;

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-ink-3">
        <button onClick={() => router.push("/admin/users")} className="hover:underline">Users</button>
        <span className="mx-2">/</span>
        <span>{user.display_name ?? user.email}</span>
      </nav>

      <div className="rounded-lg border border-line bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{user.display_name ?? user.email}</h1>
            <p className="text-sm text-ink-3 mt-1">{user.email}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${user.active !== false ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
            {user.active !== false ? "Active" : "Inactive"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { label: "Display Name", value: user.display_name ?? "—" },
          { label: "Email", value: user.email },
          { label: "Role", value: user.role ?? "—" },
          { label: "Status", value: user.active !== false ? "Active" : "Inactive" },
          { label: "Tenant", value: user.tenant_id ?? "—" },
          { label: "User ID", value: user.id.slice(0, 8) + "…" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-line bg-card p-4">
            <p className="text-xs text-ink-3 uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-sm font-medium break-all">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
