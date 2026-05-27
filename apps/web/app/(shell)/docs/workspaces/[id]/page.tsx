"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getWorkspace, listDocuments, type Workspace } from "@/lib/api/documents";
import type { DocSummary } from "@/lib/api/documents";

export default function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ws, setWs] = useState<Workspace | null>(null);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getWorkspace(id),
      listDocuments({ workspace_id: id, limit: 50 }),
    ]).then(([w, result]) => {
      setWs(w);
      setDocs(result.items);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!ws) return <div className="p-8 text-destructive">Workspace not found.</div>;

  const kindColors: Record<string, string> = {
    pm: "bg-blue-100 text-blue-800",
    ba: "bg-purple-100 text-purple-800",
    sa: "bg-orange-100 text-orange-800",
    expert: "bg-green-100 text-green-800",
  };

  const statusColors: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    review: "bg-yellow-100 text-yellow-800",
    approved: "bg-green-100 text-green-800",
    archived: "bg-gray-200 text-gray-500",
  };

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-muted-foreground">
        <button onClick={() => router.push("/docs/workspaces")} className="hover:underline">Workspaces</button>
        <span className="mx-2">/</span>
        <span>{ws.name}</span>
      </nav>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{ws.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">Project: {ws.projectId}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${kindColors[ws.kind] ?? "bg-muted text-muted-foreground"}`}>
            {ws.kind}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { label: "Kind", value: ws.kind },
          { label: "Documents", value: String(docs.length) },
          { label: "Created", value: ws.createdAt ? ws.createdAt.slice(0, 10) : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-lg font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {docs.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
            Documents ({docs.length})
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground text-xs uppercase">
                <th className="py-2 pr-4">Title</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Updated</th>
              </tr>
            </thead>
            <tbody>
              {docs.map(doc => (
                <tr key={doc.id} className="border-t border-border hover:bg-muted/30 cursor-pointer"
                  onClick={() => router.push('/docs/documents/' + doc.id)}>
                  <td className="py-2 pr-4 font-medium">{doc.title}</td>
                  <td className="py-2 pr-4 text-muted-foreground capitalize">{doc.type?.replace("_", " ") ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <span className={`px-2 py-0.5 rounded text-xs ${statusColors[doc.status] ?? ""}`}>
                      {doc.status}
                    </span>
                  </td>
                  <td className="py-2 text-muted-foreground">{doc.updatedAt ? doc.updatedAt.slice(0, 10) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
