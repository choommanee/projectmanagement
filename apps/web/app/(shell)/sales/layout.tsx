"use client";
import { useRouter } from "next/navigation";
import { AppShell } from "@/shell/AppShell";
import { useAppDefinition, useAppList } from "@/shell/useAppDefinition";

export default function SalesLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const q = useAppDefinition("sales");
  const { data: appList = [] } = useAppList();
  if (q.isLoading) return <div className="p-6 text-sm text-fgMuted">Loading…</div>;
  if (!q.data)     return <div className="p-6 text-sm text-fgMuted">App not found.</div>;
  return (
    <AppShell app={q.data} apps={appList} onAppSwitch={(id) => router.push(`/${id}/home`)}>
      {children}
    </AppShell>
  );
}
