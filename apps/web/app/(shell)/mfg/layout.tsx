"use client";
import { useRouter } from "next/navigation";
import { AppShell } from "@/shell/AppShell";
import { useAppDefinition, useAppList } from "@/shell/useAppDefinition";

const mockUser = { id: "u1", displayName: "Demo User", email: "demo@x.com", tenantSlug: "acme" };

export default function MfgLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const q = useAppDefinition("mfg");
  const { data: appList = [] } = useAppList();
  if (q.isLoading) return <div className="p-6 text-sm text-fgMuted">Loading…</div>;
  if (!q.data)     return <div className="p-6 text-sm text-fgMuted">App not found.</div>;
  return (
    <AppShell
      app={q.data}
      user={mockUser}
      apps={appList}
      onAppSwitch={(id) => router.push(`/${id}/home`)}
    >
      {children}
    </AppShell>
  );
}
