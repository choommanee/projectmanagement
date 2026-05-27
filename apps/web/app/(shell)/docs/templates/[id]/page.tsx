"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getTemplate, type Template } from "@/lib/api/documents";

export default function TemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tmpl, setTmpl] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getTemplate(id).then(setTmpl).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!tmpl) return <div className="p-8 text-destructive">Template not found.</div>;

  const bodyPreview = JSON.stringify(tmpl.body ?? {}, null, 2);

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-muted-foreground">
        <button onClick={() => router.push("/docs/templates")} className="hover:underline">Templates</button>
        <span className="mx-2">/</span>
        <span>{tmpl.name}</span>
      </nav>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{tmpl.name}</h1>
            <p className="text-sm text-muted-foreground mt-1 capitalize">{tmpl.type?.replace("_", " ")}</p>
          </div>
          {tmpl.isSystem && (
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">System</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Type", value: tmpl.type?.replace("_", " ") ?? "—" },
          { label: "System Template", value: tmpl.isSystem ? "Yes" : "No" },
          { label: "Created", value: tmpl.createdAt ? tmpl.createdAt.slice(0, 10) : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-sm font-medium capitalize">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">Template Structure</h2>
        <pre className="text-xs bg-muted rounded p-4 overflow-auto max-h-96 font-mono">
          {bodyPreview.length > 2000 ? bodyPreview.slice(0, 2000) + "\n…" : bodyPreview}
        </pre>
      </div>
    </div>
  );
}
