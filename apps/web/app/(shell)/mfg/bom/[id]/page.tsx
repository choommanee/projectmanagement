"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getBom, activateBom, type BOMHeader, type BOMLine, type BOMStatus } from "@/lib/api/mfg";

export default function BomDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [bom, setBom] = useState<BOMHeader | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getBom(id).then(setBom).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  async function handleActivate() {
    if (!bom) return;
    setSaving(true);
    try {
      await activateBom(bom.id);
      setBom(prev => prev ? { ...prev, status: "active" as BOMStatus } : prev);
    } finally { setSaving(false); }
  }

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!bom) return <div className="p-8 text-destructive">BOM not found.</div>;

  const statusColors: Record<BOMStatus, string> = {
    draft: "bg-muted text-muted-foreground",
    active: "bg-green-100 text-green-800",
    obsolete: "bg-gray-200 text-gray-500",
  };

  const lines: BOMLine[] = bom.lines ?? [];

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-muted-foreground">
        <button onClick={() => router.push("/mfg/bom")} className="hover:underline">BOM</button>
        <span className="mx-2">/</span>
        <span>v{bom.version} — {bom.itemId}</span>
      </nav>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">BOM v{bom.version}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Item: {bom.itemId}
              {bom.isDefault && <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">Default</span>}
            </p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusColors[bom.status]}`}>
            {bom.status}
          </span>
        </div>
        {bom.status === "draft" && (
          <div className="mt-4">
            <button onClick={handleActivate} disabled={saving}
              className="px-4 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
              Activate BOM
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Version", value: String(bom.version) },
          { label: "Lines", value: String(lines.length) },
          { label: "Effective From", value: bom.effectiveFrom ?? "—" },
          { label: "Effective To", value: bom.effectiveTo ?? "—" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-lg font-semibold font-mono">{value}</p>
          </div>
        ))}
      </div>

      {lines.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
            BOM Lines ({lines.length})
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground text-xs uppercase">
                <th className="py-2 pr-4">Component</th>
                <th className="py-2 pr-4 text-right">Qty</th>
                <th className="py-2 pr-4 text-right">Scrap %</th>
                <th className="py-2 pr-4">Phantom</th>
                <th className="py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {lines.sort((a, b) => a.sortOrder - b.sortOrder).map(line => (
                <tr key={line.id} className="border-t border-border">
                  <td className="py-2 pr-4 font-mono text-xs">{line.childItemId}</td>
                  <td className="py-2 pr-4 text-right font-mono">{line.qty}</td>
                  <td className="py-2 pr-4 text-right font-mono">{line.scrapPct}%</td>
                  <td className="py-2 pr-4">{line.isPhantom ? "Yes" : "No"}</td>
                  <td className="py-2 text-muted-foreground text-xs">{line.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {bom.notes && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Notes</p>
          <p className="text-sm">{bom.notes}</p>
        </div>
      )}
    </div>
  );
}
