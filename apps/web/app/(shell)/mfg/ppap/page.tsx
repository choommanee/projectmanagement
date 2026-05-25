"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import {
  listPpap, createPpap,
  type PpapSubmission, type PpapStatus,
} from "@/lib/api/quality";
import { listItems, type Item } from "@/lib/api/mfg";

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "interim", label: "Interim" },
];

function statusTone(s: PpapStatus): "neutral" | "info" | "success" | "danger" | "warning" {
  if (s === "draft") return "neutral";
  if (s === "submitted") return "info";
  if (s === "approved") return "success";
  if (s === "rejected") return "danger";
  if (s === "interim") return "warning";
  return "neutral";
}

function NewPpapDialog({ items, onClose, onCreated }: {
  items: Item[];
  onClose: () => void;
  onCreated: (p: PpapSubmission) => void;
}) {
  const [form, setForm] = useState({ part_no: "", item_id: "", customer: "", level: "3" });
  const [itemQuery, setItemQuery] = useState("");
  const [itemResults, setItemResults] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchItem(q: string) {
    if (!q.trim()) { setItemResults([]); return; }
    try { const r = await listItems({ q, limit: 10 }); setItemResults(r.items); } catch { /* noop */ }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.part_no || !form.item_id || !form.customer) { setError("Part No, Item, and Customer are required"); return; }
    setLoading(true); setError(null);
    try {
      const p = await createPpap({
        item_id: form.item_id,
        part_no: form.part_no,
        customer: form.customer,
        level: Number(form.level),
      });
      onCreated(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create PPAP");
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-md border border-line bg-paper shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">New PPAP Submission</h2>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-4 p-4">
          {error && <p className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Part No *</label>
              <Input value={form.part_no} onChange={e => setForm(f => ({ ...f, part_no: e.target.value }))} placeholder="PN-001" required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">PPAP Level *</label>
              <select title="PPAP Level" value={form.level} onChange={e => setForm(f => ({ ...f, level: e.target.value }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>Level {n}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Item *</label>
            <div className="relative">
              <Input value={itemQuery} onChange={e => { setItemQuery(e.target.value); void searchItem(e.target.value); }} placeholder="Search item code…" />
              {itemResults.length > 0 && (
                <ul className="absolute left-0 top-full z-30 mt-1 w-full rounded-sm border border-line bg-surface shadow-pop">
                  {itemResults.map(it => (
                    <li key={it.id} className="cursor-pointer px-3 py-1.5 text-xs hover:bg-surface-2"
                      onClick={() => { setForm(f => ({ ...f, item_id: it.id })); setItemQuery(`${it.code} — ${it.name}`); setItemResults([]); }}>
                      <span className="font-mono">{it.code}</span> — {it.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Customer *</label>
            <Input value={form.customer} onChange={e => setForm(f => ({ ...f, customer: e.target.value }))} placeholder="e.g. OEM Corp" required />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={loading}>Create PPAP</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PpapPage() {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<PpapSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [itemMap, setItemMap] = useState<Map<string, Item>>(new Map());
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setSubmissions(await listPpap()); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to load PPAP"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    void listItems({ limit: 500 }).then(r => {
      setItems(r.items);
      setItemMap(new Map(r.items.map(i => [i.id, i])));
    }).catch(() => {});
  }, [load]);

  const filtered = submissions.filter(s => !statusFilter || s.status === statusFilter);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "PPAP" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New PPAP", variant: "primary", onClick: () => setShowNew(true) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-4 py-2">
        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map(t => (
            <button key={t.value} type="button" onClick={() => setStatusFilter(t.value)}
              className={`rounded-xs px-3 py-1 text-xs font-medium transition-colors ${statusFilter === t.value ? "bg-accent text-white" : "text-ink-2 hover:bg-surface-2"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-ink-3">{filtered.length} submissions</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
        {loading && !submissions.length ? (
          <div className="space-y-px">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="h-10 animate-pulse border-b border-border bg-surface-2" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Part No</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Level</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Submitted</th>
                <th className="px-4 py-2">Decision</th>
                <th className="px-4 py-2">v</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => {
                const item = itemMap.get(s.itemId);
                return (
                  <tr key={s.id} onClick={() => router.push(`/mfg/ppap/${s.id}`)}
                    className="cursor-pointer border-b border-line hover:bg-surface-2">
                    <td className="px-4 py-2 font-mono text-xs font-semibold text-ink">{s.partNo}</td>
                    <td className="px-4 py-2">
                      <div className="font-mono text-xs text-ink">{item?.code ?? "—"}</div>
                      <div className="text-xs text-ink-3">{item?.name ?? ""}</div>
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-2">{s.customer}</td>
                    <td className="px-4 py-2"><Tag tone="accent">Level {s.level}</Tag></td>
                    <td className="px-4 py-2"><Tag tone={statusTone(s.status)} dot>{s.status}</Tag></td>
                    <td className="px-4 py-2 text-xs text-ink-3">
                      {s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-3">
                      {s.decisionAt ? new Date(s.decisionAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-3">{s.version}</td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="flex flex-col items-center gap-2 py-16 text-fgMuted">
                      <p className="text-sm text-ink-3">No PPAP submissions found.</p>
                      <Button size="sm" variant="ghost" onClick={() => setShowNew(true)}>+ New PPAP</Button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewPpapDialog items={items} onClose={() => setShowNew(false)} onCreated={p => {
          setShowNew(false);
          router.push(`/mfg/ppap/${p.id}`);
        }} />
      )}
    </div>
  );
}
