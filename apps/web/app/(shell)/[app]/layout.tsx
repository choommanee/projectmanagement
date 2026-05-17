"use client";
import { use } from "react";
import { AppShell } from "@/shell/AppShell";
import { useAppDefinition } from "@/shell/useAppDefinition";

const mockUser = { id: "u1", displayName: "Demo User", email: "demo@x.com", tenantSlug: "acme" };

export default function AppLayout({ children, params }: { children: React.ReactNode; params: Promise<{ app: string }> }) {
  const { app } = use(params);
  const q = useAppDefinition(app);
  if (q.isLoading) return <div className="p-6 text-sm text-fgMuted">Loading…</div>;
  if (!q.data)     return <div className="p-6 text-sm text-fgMuted">App not found.</div>;
  return <AppShell app={q.data} user={mockUser}>{children}</AppShell>;
}
