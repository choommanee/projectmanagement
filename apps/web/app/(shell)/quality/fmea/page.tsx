"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import {
  listFmea, createFmea,
  type Fmea, type FmeaType,
} from "@/lib/api/quality";
import { listItems, type Item } from "@/lib/api/mfg";

function typeTone(t: FmeaType): "accent" | "info" {
  return t === "pfmea" ? "accent" : "info";
}

function NewFmeaDialog({ items, onClose, onCreated }: {
  items: Item[];
  onClose: () => void;
  onCreated: (f: Fmea) => void;
}) {
  const [form, setForm] = useState({ type: "pfmea" as FmeaType, item_id: "", name: "", team: "" });
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
    if (!form.name || !form.item_id) { setError("Name and Item are required"); return; }
    setLoading(true); setError(null);
    try {
      const teamArr = form.team ? form.team.split(",").map(s => s.trim()).filter(Boolean) : [];
      const f = await createFmea({ type: form.type, item_id: form.item_id, name: form.name, team: teamArr });
      onCreated(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create FMEA");
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-md border border-line bg-paper shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">New FMEA</h2>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-4 p-4">
          {error && <p className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">FMEA Type *</label>
            <select title="FMEA Type" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as FmeaType }))}
              className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
              <option value="pfmea">PFMEA — Process FMEA</option>
              <option value="dfmea">DFMEA — Design FMEA</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Name *</label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Assembly Process FMEA" required />
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
            <label className="mb-1 block text-xs font-medium text-ink-2">Team (comma-separated, optional)</label>
            <Input value={form.team} onChange={e => setForm(f => ({ ...f, team: e.target.value }))} placeholder="Alice, Bob, Charlie" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={loading}>Create FMEA</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function FmeaPage() {
  const router = useRouter();
  const [fmeas, setFmeas] = useState<Fmea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [itemMap, setItemMap] = useState<Map<string, Item>>(new Map());
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setFmeas(await listFmea()); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to load FMEA"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    void listItems({ limit: 500 }).then(r => {
      setItems(r.items);
      setItemMap(new Map(r.items.map(i => [i.id, i])));
    }).catch(() => {});
  }, [load]);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/quality/home" }, { label: "FMEA" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New FMEA", variant: "primary", onClick: () => setShowNew(true) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
        {loading && !fmeas.length ? (
          <div className="space-y-px">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="h-10 animate-pulse border-b border-border bg-surface-2" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Team</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">v</th>
              </tr>
            </thead>
            <tbody>
              {fmeas.map(f => {
                const item = itemMap.get(f.itemId);
                return (
                  <tr key={f.id} onClick={() => router.push(`/quality/fmea/${f.id}`)}
                    className="cursor-pointer border-b border-line hover:bg-surface-2">
                    <td className="px-4 py-2 font-medium text-ink">{f.name}</td>
                    <td className="px-4 py-2"><Tag tone={typeTone(f.type)}>{f.type.toUpperCase()}</Tag></td>
                    <td className="px-4 py-2">
                      {item ? <span className="font-mono text-xs">{item.code}</span> : <span className="font-mono text-xs text-ink-3">{f.itemId.slice(0, 8)}</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-2">
                      {f.team.length > 0 ? (
                        <span>{f.team.length} member{f.team.length !== 1 ? "s" : ""}</span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <Tag tone={f.status === "active" ? "success" : "neutral"}>{f.status}</Tag>
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-3">{f.version}</td>
                  </tr>
                );
              })}
              {!loading && fmeas.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="flex flex-col items-center gap-2 py-16 text-fgMuted">
                      <p className="text-sm text-ink-3">No FMEA records found.</p>
                      <Button size="sm" variant="ghost" onClick={() => setShowNew(true)}>+ New FMEA</Button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewFmeaDialog items={items} onClose={() => setShowNew(false)} onCreated={f => {
          setShowNew(false);
          router.push(`/quality/fmea/${f.id}`);
        }} />
      )}
    </div>
  );
}
