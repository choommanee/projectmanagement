"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  getNCR, getCAPA, updateNCR, attachCAPA, updateCAPA,
  type NCR, type CAPA, type NcrStatus,
} from "@/lib/api/quality";

const STATUS_FLOW: NcrStatus[] = ["open", "investigating", "corrected", "closed"];
const STATUS_COLORS: Record<NcrStatus, string> = {
  open: "bg-red-100 text-red-700",
  investigating: "bg-amber-100 text-amber-700",
  corrected: "bg-blue-100 text-blue-700",
  closed: "bg-green-100 text-green-700",
};
const SEVERITY_COLORS = ["", "bg-surface-2 text-ink-3", "bg-yellow-100 text-yellow-700", "bg-amber-100 text-amber-700", "bg-orange-100 text-orange-700", "bg-red-100 text-red-700"];

export default function NCRDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ncr, setNcr] = useState<NCR | null>(null);
  const [capa, setCapa] = useState<CAPA | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCAPAForm, setShowCAPAForm] = useState(false);
  const [rootCause, setRootCause] = useState("");
  const [action, setAction] = useState("");
  const [targetDate, setTargetDate] = useState("");

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getNCR(id).then(setNcr),
      getCAPA(id).then(setCapa).catch(() => null),
    ]).finally(() => setLoading(false));
  }, [id]);

  async function advance() {
    if (!ncr) return;
    const idx = STATUS_FLOW.indexOf(ncr.status);
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return;
    setSaving(true);
    const updated = await updateNCR(ncr.id, { status: STATUS_FLOW[idx + 1], version: ncr.version }).catch(() => null);
    if (updated) setNcr(updated);
    setSaving(false);
  }

  async function handleAttachCAPA() {
    if (!ncr || !rootCause || !action) return;
    setSaving(true);
    const c = await attachCAPA(ncr.id, {
      root_cause: rootCause,
      action,
      owner_id: "",
      target_date: targetDate || undefined,
    }).catch(() => null);
    if (c) { setCapa(c); setShowCAPAForm(false); setRootCause(""); setAction(""); setTargetDate(""); }
    setSaving(false);
  }

  if (loading) return <div className="p-6 text-sm text-ink-3">Loading…</div>;
  if (!ncr) return <div className="p-6 text-sm text-red-600">NCR not found</div>;

  const canAdvance = ncr.status !== "closed";

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Quality" }, { label: "NCRs", href: "/quality/ncrs" }, { label: ncr.id.slice(0, 8) }]} />

      {/* Header */}
      <div className="rounded-lg border border-line bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[ncr.status]}`}>{ncr.status}</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_COLORS[ncr.severity] ?? ""}`}>Severity {ncr.severity}/5</span>
          </div>
          <p className="text-sm font-medium">{ncr.description}</p>
          <div className="mt-2 text-xs text-ink-3 space-y-0.5">
            <div>Qty: <span className="font-mono">{ncr.qty}</span></div>
            {ncr.itemId && <div>Item: <span className="font-mono">{ncr.itemId}</span></div>}
            {ncr.lotId && <div>Lot: <span className="font-mono">{ncr.lotId}</span></div>}
            {ncr.workOrderId && <div>WO: <span className="font-mono">{ncr.workOrderId}</span></div>}
            <div>Created: {ncr.createdAt?.slice(0, 10)}</div>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {canAdvance && (
            <button onClick={advance} disabled={saving} className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
              → {STATUS_FLOW[STATUS_FLOW.indexOf(ncr.status) + 1]}
            </button>
          )}
          <button onClick={() => router.back()} className="px-3 py-1.5 text-xs rounded border border-line text-ink-3 hover:text-ink">← Back</button>
        </div>
      </div>

      {/* CAPA Section */}
      <div className="rounded-lg border border-line overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-surface-2">
          <span className="text-sm font-medium">CAPA (Corrective &amp; Preventive Action)</span>
          {!capa && !showCAPAForm && (
            <button onClick={() => setShowCAPAForm(true)} className="text-xs px-2 py-1 rounded bg-accent text-white hover:bg-accent/90">+ Attach CAPA</button>
          )}
        </div>

        {showCAPAForm && (
          <div className="p-4 border-b border-line bg-surface-2 space-y-3">
            <div>
              <label className="text-xs text-ink-3">Root Cause</label>
              <textarea value={rootCause} onChange={e => setRootCause(e.target.value)} rows={2}
                className="w-full mt-0.5 text-sm border border-line rounded px-2 py-1.5 bg-surface" />
            </div>
            <div>
              <label className="text-xs text-ink-3">Corrective Action</label>
              <textarea value={action} onChange={e => setAction(e.target.value)} rows={2}
                className="w-full mt-0.5 text-sm border border-line rounded px-2 py-1.5 bg-surface" />
            </div>
            <div className="flex items-end gap-3">
              <div>
                <label className="text-xs text-ink-3">Target Date</label>
                <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
                  className="mt-0.5 text-sm border border-line rounded px-2 py-1.5 bg-surface" />
              </div>
              <button onClick={handleAttachCAPA} disabled={saving} className="px-3 py-1.5 text-xs rounded bg-accent text-white disabled:opacity-50">Save</button>
              <button onClick={() => setShowCAPAForm(false)} className="px-3 py-1.5 text-xs rounded border border-line">Cancel</button>
            </div>
          </div>
        )}

        {capa ? (
          <div className="p-4 space-y-3 text-sm">
            <div>
              <div className="text-xs text-ink-3 mb-0.5">Root Cause</div>
              <p className="text-sm">{capa.rootCause || "—"}</p>
            </div>
            <div>
              <div className="text-xs text-ink-3 mb-0.5">Corrective Action</div>
              <p className="text-sm">{capa.action || "—"}</p>
            </div>
            <div className="flex gap-6 text-xs text-ink-3">
              <div>Target: {capa.targetDate?.slice(0, 10) ?? "—"}</div>
              <div>Status: <span className="text-foreground font-medium">{capa.status}</span></div>
            </div>
            {capa.evidence && (
              <div>
                <div className="text-xs text-ink-3 mb-0.5">Evidence</div>
                <p className="text-xs">{capa.evidence}</p>
              </div>
            )}
          </div>
        ) : !showCAPAForm ? (
          <div className="px-4 py-6 text-center text-sm text-ink-3">No CAPA attached</div>
        ) : null}
      </div>
    </div>
  );
}
