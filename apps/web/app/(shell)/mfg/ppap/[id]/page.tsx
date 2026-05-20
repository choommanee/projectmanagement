"use client";
import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import {
  getPpap, updatePpap, listPpapElements, patchPpapElement,
  type PpapSubmission, type PpapStatus, type PpapElement, type PpapElementStatus,
} from "@/lib/api/quality";
import { listItems, type Item } from "@/lib/api/mfg";

function statusTone(s: PpapStatus): "neutral" | "info" | "success" | "danger" | "warning" {
  if (s === "draft") return "neutral";
  if (s === "submitted") return "info";
  if (s === "approved") return "success";
  if (s === "rejected") return "danger";
  if (s === "interim") return "warning";
  return "neutral";
}

function elemStatusTone(s: PpapElementStatus): "neutral" | "info" | "success" | "danger" | "warning" {
  if (s === "complete") return "success";
  if (s === "in_progress") return "info";
  if (s === "not_required" || s === "not_applicable") return "neutral";
  return "neutral";
}

function ElementRow({ el, onSaved }: { el: PpapElement; onSaved: (updated: PpapElement) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState({ status: el.status, evidence_url: el.evidenceUrl, notes: el.notes });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true); setError(null);
    try {
      const updated = await patchPpapElement(el.id, {
        status: form.status as PpapElementStatus,
        evidence_url: form.evidence_url,
        notes: form.notes,
      });
      onSaved(updated);
      setExpanded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally { setSaving(false); }
  }

  return (
    <>
      <tr
        className={`cursor-pointer border-b border-line hover:bg-surface-2 ${expanded ? "bg-accent-soft/10" : ""}`}
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-2 font-mono text-xs text-ink-3">{el.elementNo}</td>
        <td className="px-4 py-2 text-sm text-ink">{el.name}</td>
        <td className="px-4 py-2"><Tag tone={elemStatusTone(el.status)} dot>{el.status.replace(/_/g, " ")}</Tag></td>
        <td className="px-4 py-2">
          {el.evidenceUrl ? (
            <a href={el.evidenceUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-accent underline" onClick={e => e.stopPropagation()}>
              View
            </a>
          ) : <span className="text-xs text-ink-3">—</span>}
        </td>
        <td className="px-4 py-2 text-xs text-ink-3 max-w-xs truncate">{el.notes || "—"}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-line bg-surface">
          <td colSpan={5} className="px-4 py-3">
            {error && <p className="mb-2 text-xs text-danger">{error}</p>}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-2">Status</label>
                <select title="Status" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as PpapElementStatus }))}
                  className="h-8 w-full rounded-xs border border-line bg-surface px-2 text-xs focus:border-accent focus:outline-none">
                  <option value="not_required">Not Required</option>
                  <option value="in_progress">In Progress</option>
                  <option value="complete">Complete</option>
                  <option value="not_applicable">Not Applicable</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-2">Evidence URL</label>
                <Input value={form.evidence_url} onChange={e => setForm(f => ({ ...f, evidence_url: e.target.value }))} placeholder="https://…" className="h-8 text-xs" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-2">Notes</label>
                <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes…" className="h-8 text-xs" />
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              <Button type="button" size="sm" variant="primary" loading={saving} onClick={save}>Save</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setExpanded(false)}>Cancel</Button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function PpapDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [submission, setSubmission] = useState<PpapSubmission | null>(null);
  const [elements, setElements] = useState<PpapElement[]>([]);
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [sub, els] = await Promise.all([getPpap(id), listPpapElements(id)]);
      setSubmission(sub);
      setElements(els.sort((a, b) => a.elementNo - b.elementNo));
      const itemsRes = await listItems({ limit: 500 });
      setItem(itemsRes.items.find(i => i.id === sub.itemId) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load PPAP");
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function handleStatusChange(status: PpapStatus) {
    if (!submission) return;
    setSaving(true);
    try {
      const updated = await updatePpap(id, { status, version: submission.version });
      setSubmission(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status update failed");
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-ink-3">Loading…</div>;
  if (error) return <div className="m-6 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>;
  if (!submission) return <div className="m-6 text-sm text-ink-3">Not found.</div>;

  const completeCount = elements.filter(e => e.status === "complete").length;
  const pct = elements.length > 0 ? Math.round((completeCount / elements.length) * 100) : 0;

  const commandActions = [
    { id: "back", label: "← Back", variant: "ghost" as const, onClick: () => router.push("/mfg/ppap") },
    { id: "sep1", kind: "separator" as const },
    ...(submission.status === "draft" ? [{ id: "submit", label: "Submit", variant: "primary" as const, onClick: () => handleStatusChange("submitted"), disabled: saving }] : []),
    ...(submission.status === "submitted" ? [
      { id: "approve", label: "Approve", variant: "primary" as const, onClick: () => handleStatusChange("approved"), disabled: saving },
      { id: "reject", label: "Reject", variant: "ghost" as const, onClick: () => handleStatusChange("rejected"), disabled: saving },
      { id: "interim", label: "Interim Approval", variant: "ghost" as const, onClick: () => handleStatusChange("interim"), disabled: saving },
    ] : []),
    ...(submission.status === "rejected" ? [{ id: "redraft", label: "Re-draft", variant: "ghost" as const, onClick: () => handleStatusChange("draft"), disabled: saving }] : []),
  ];

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[
        { label: "Home", href: "/mfg/home" },
        { label: "PPAP", href: "/mfg/ppap" },
        { label: submission.partNo },
      ]} />
      <CommandBar actions={commandActions} />

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-4 py-3">
        <h2 className="font-mono text-base font-semibold text-ink">{submission.partNo}</h2>
        {item && (
          <span className="text-sm text-ink-2">
            <span className="font-mono">{item.code}</span> — {item.name}
          </span>
        )}
        <span className="text-xs text-ink-3">{submission.customer}</span>
        <Tag tone="accent">Level {submission.level}</Tag>
        <Tag tone={statusTone(submission.status)} dot>{submission.status}</Tag>
        {submission.submittedAt && (
          <span className="text-xs text-ink-3">Submitted: {new Date(submission.submittedAt).toLocaleDateString()}</span>
        )}
        {submission.decisionAt && (
          <span className="text-xs text-ink-3">Decision: {new Date(submission.decisionAt).toLocaleDateString()}</span>
        )}
        <span className="ml-auto text-xs text-ink-3">v{submission.version}</span>
      </div>

      {/* Progress bar */}
      <div className="border-b border-line bg-paper px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-2">{completeCount}/{elements.length} elements complete</span>
          <div className="flex-1 h-2 rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pct}%` }} />
          </div>
          <span className="font-mono text-xs text-ink-3">{pct}%</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
              <th className="px-4 py-2 w-12">#</th>
              <th className="px-4 py-2">Element Name</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Evidence</th>
              <th className="px-4 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {elements.map(el => (
              <ElementRow key={el.id} el={el} onSaved={updated => setElements(prev => prev.map(e => e.id === updated.id ? updated : e))} />
            ))}
            {elements.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-3">No elements found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
