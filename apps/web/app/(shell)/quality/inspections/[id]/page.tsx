"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { getInspection, type Inspection, type InspectionResult } from "@/lib/api/quality";

const RESULT_COLORS: Record<InspectionResult, string> = {
  pass: "bg-green-100 text-green-700",
  fail: "bg-red-100 text-red-700",
  hold: "bg-amber-100 text-amber-700",
};

export default function InspectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [insp, setInsp] = useState<Inspection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getInspection(id).then(setInsp).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!insp) return <div className="p-6 text-sm text-red-600">Inspection not found</div>;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Quality" }, { label: "Inspections", href: "/quality/inspections" }, { label: insp.id.slice(0, 8) }]} />

      {/* Header card */}
      <div className="rounded-lg border border-border bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RESULT_COLORS[insp.result]}`}>{insp.result}</span>
            <span className="text-xs text-muted-foreground font-mono">{insp.inspectedAt?.slice(0, 10)}</span>
          </div>
          <div className="text-xs text-muted-foreground space-y-0.5">
            <div>Inspector: <span className="text-foreground">{insp.inspector}</span></div>
            <div>Item: <span className="font-mono">{insp.itemId}</span></div>
            {insp.lotId && <div>Lot: <span className="font-mono">{insp.lotId}</span></div>}
            {insp.workOrderId && <div>Work Order: <span className="font-mono">{insp.workOrderId}</span></div>}
            {insp.notes && <div className="mt-1">{insp.notes}</div>}
          </div>
        </div>
        <button onClick={() => router.back()} className="text-xs text-muted-foreground hover:text-foreground border border-border px-3 py-1.5 rounded">← Back</button>
      </div>

      {/* Measurements */}
      {insp.measurements && insp.measurements.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-3 bg-muted/50 text-sm font-medium">Measurements ({insp.measurements.length})</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase bg-muted/30">
                <tr>
                  {Object.keys(insp.measurements[0]).map(key => (
                    <th key={key} className="px-4 py-2 text-left font-medium">{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {insp.measurements.map((m, i) => (
                  <tr key={i} className="border-t border-border hover:bg-muted/20">
                    {Object.values(m).map((v, j) => (
                      <td key={j} className="px-4 py-2 text-xs font-mono">{String(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(!insp.measurements || insp.measurements.length === 0) && (
        <div className="rounded-lg border border-border px-4 py-6 text-center text-sm text-muted-foreground">No measurements recorded</div>
      )}
    </div>
  );
}
