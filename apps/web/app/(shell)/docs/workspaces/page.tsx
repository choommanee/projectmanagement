"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Tag } from "@pmplatform/ui-kit";
import { listAllWorkspaces, listDocuments, type Workspace, type WorkspaceKind } from "@/lib/api/documents";

const KIND_TONES: Record<WorkspaceKind, "accent" | "info" | "success" | "warning"> = {
  ba:     "accent",
  sa:     "info",
  pm:     "success",
  expert: "warning",
};

const KIND_LABELS: Record<WorkspaceKind, string> = {
  ba:     "BA",
  sa:     "SA",
  pm:     "PM",
  expert: "Expert",
};

const WS_ROUTES: Record<WorkspaceKind, string> = {
  ba:     "/pm/ba",
  sa:     "/pm/sa",
  pm:     "/pm/home",
  expert: "/pm/expert",
};

function fmtDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function WorkspacesPage() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [docCounts, setDocCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listAllWorkspaces({ limit: 200 })
      .then(async ({ items }) => {
        setWorkspaces(items);
        // fetch doc counts per workspace in parallel (best-effort)
        const counts = await Promise.all(
          items.map((ws) =>
            listDocuments({ workspace_id: ws.id, limit: 1 })
              .then((r) => [ws.id, r.total] as [string, number])
              .catch(() => [ws.id, 0] as [string, number])
          )
        );
        setDocCounts(Object.fromEntries(counts));
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Document Hub", href: "/docs/home" }, { label: "Workspaces" }]} />

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Content</p>
          <h1 className="mt-0.5 text-xl font-semibold text-ink">Workspaces</h1>
        </div>

        {error && (
          <div className="mb-4 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">{error}</div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-10 animate-pulse rounded-xs bg-surface-2" />
            ))}
          </div>
        ) : workspaces.length === 0 ? (
          <div className="flex items-center justify-center rounded-sm border border-dashed border-line py-20 text-center">
            <p className="text-sm text-ink-3">No workspaces found. Create a project to auto-provision workspaces.</p>
          </div>
        ) : (
          <div className="rounded-sm border border-line bg-surface shadow-xs overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/50">
                  <th className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-ink-3">Name</th>
                  <th className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-ink-3">Type</th>
                  <th className="px-4 py-2.5 text-right font-mono text-[10px] uppercase tracking-wider text-ink-3">Documents</th>
                  <th className="px-4 py-2.5 text-right font-mono text-[10px] uppercase tracking-wider text-ink-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {workspaces.map((ws) => (
                  <tr
                    key={ws.id}
                    className="border-b border-line last:border-0 hover:bg-surface-2 cursor-pointer transition-colors"
                    onClick={() => router.push(`${WS_ROUTES[ws.kind]}/${ws.projectId}`)}
                  >
                    <td className="px-4 py-2.5 font-medium text-ink">{ws.name}</td>
                    <td className="px-4 py-2.5">
                      <Tag tone={KIND_TONES[ws.kind]}>{KIND_LABELS[ws.kind]}</Tag>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[11px] text-ink tabular-nums">
                      {docCounts[ws.id] ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[11px] text-ink-3 tabular-nums">
                      {fmtDate(ws.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
