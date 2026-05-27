"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getDocument, updateDocument, listVersions, listComments,
  type Document, type DocumentVersion, type DocComment, type DocumentStatus,
} from "@/lib/api/documents";

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [doc, setDoc] = useState<Document | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [comments, setComments] = useState<DocComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"details" | "versions" | "comments">("details");

  useEffect(() => {
    if (!id) return;
    Promise.all([getDocument(id), listVersions(id), listComments(id)])
      .then(([d, v, c]) => { setDoc(d); setVersions(v); setComments(c); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  async function handleStatus(status: DocumentStatus) {
    if (!doc) return;
    setSaving(true);
    try {
      const updated = await updateDocument(doc.id, { status, version: doc.version });
      setDoc(updated);
    } finally { setSaving(false); }
  }

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!doc) return <div className="p-8 text-destructive">Document not found.</div>;

  const statusColors: Record<DocumentStatus, string> = {
    draft: "bg-muted text-muted-foreground",
    review: "bg-yellow-100 text-yellow-800",
    approved: "bg-green-100 text-green-800",
    archived: "bg-gray-200 text-gray-500",
  };

  const tabs = [
    { id: "details" as const, label: "Details" },
    { id: "versions" as const, label: `Versions (${versions.length})` },
    { id: "comments" as const, label: `Comments (${comments.length})` },
  ];

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-muted-foreground">
        <button onClick={() => router.push("/docs/documents")} className="hover:underline">Documents</button>
        <span className="mx-2">/</span>
        <span>{doc.title}</span>
      </nav>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{doc.title}</h1>
            <p className="text-sm text-muted-foreground mt-1 capitalize">{doc.type?.replace("_", " ")} · v{doc.version}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusColors[doc.status]}`}>
            {doc.status}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {doc.status === "draft" && (
            <button onClick={() => handleStatus("review")} disabled={saving}
              className="px-4 py-1.5 text-sm bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50">
              Submit for Review
            </button>
          )}
          {doc.status === "review" && (
            <button onClick={() => handleStatus("approved")} disabled={saving}
              className="px-4 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
              Approve
            </button>
          )}
          {doc.status !== "archived" && doc.status !== "draft" && (
            <button onClick={() => handleStatus("archived")} disabled={saving}
              className="px-4 py-1.5 text-sm border border-border rounded hover:bg-muted disabled:opacity-50">
              Archive
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <nav className="flex gap-6">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${activeTab === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === "details" && (
        <div className="rounded-lg border border-border bg-card p-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
            <div><dt className="text-muted-foreground">Title</dt><dd className="font-medium">{doc.title}</dd></div>
            <div><dt className="text-muted-foreground">Type</dt><dd className="font-medium capitalize">{doc.type?.replace("_", " ") ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Status</dt><dd className="font-medium capitalize">{doc.status}</dd></div>
            <div><dt className="text-muted-foreground">Version</dt><dd className="font-medium">v{doc.version}</dd></div>
            {doc.tags && doc.tags.length > 0 && (
              <div className="col-span-2">
                <dt className="text-muted-foreground mb-1">Tags</dt>
                <dd className="flex flex-wrap gap-1">
                  {doc.tags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 bg-muted rounded text-xs">{tag}</span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {activeTab === "versions" && (
        <div className="rounded-lg border border-border bg-card p-6">
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No version history.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground text-xs uppercase">
                  <th className="py-2 pr-4">Version</th>
                  <th className="py-2 pr-4">Created At</th>
                  <th className="py-2">Author</th>
                </tr>
              </thead>
              <tbody>
                {versions.map(v => (
                  <tr key={v.id} className="border-t border-border">
                    <td className="py-2 pr-4 font-mono">v{v.rev}</td>
                    <td className="py-2 pr-4">{v.createdAt ? v.createdAt.slice(0, 10) : "—"}</td>
                    <td className="py-2 text-muted-foreground">{v.createdBy ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "comments" && (
        <div className="rounded-lg border border-border bg-card p-6 space-y-3">
          {comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No comments yet.</p>
          ) : (
            comments.map(c => (
              <div key={c.id} className={`p-3 rounded-lg border border-border ${c.resolvedAt ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <span className="font-medium">{c.authorId ?? "Unknown"}</span>
                  <span>{c.createdAt ? c.createdAt.slice(0, 10) : ""}</span>
                  {c.resolvedAt && <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">Resolved</span>}
                </div>
                <p className="text-sm">{c.body}</p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
