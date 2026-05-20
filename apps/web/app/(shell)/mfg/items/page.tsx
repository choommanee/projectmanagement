"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import { listItems, createItem, listUoms, type Item, type UOM, type ItemType, type ItemStatus } from "@/lib/api/mfg";

const STATUS_TONES: Record<ItemStatus, "success" | "neutral" | "warning"> = {
  active: "success",
  inactive: "neutral",
  obsolete: "warning",
};

const TYPE_TONES: Record<ItemType, "accent" | "info" | "success" | "warning" | "neutral" | "signal"> = {
  raw: "neutral",
  component: "info",
  assembly: "accent",
  finished: "success",
  consumable: "warning",
  service: "signal",
};

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "obsolete", label: "Obsolete" },
];

const ITEM_TYPES: { value: string; label: string }[] = [
  { value: "", label: "All Types" },
  { value: "raw", label: "Raw" },
  { value: "component", label: "Component" },
  { value: "assembly", label: "Assembly" },
  { value: "finished", label: "Finished" },
  { value: "consumable", label: "Consumable" },
  { value: "service", label: "Service" },
];

function NewItemDialog({ uoms, onClose, onCreated }: { uoms: UOM[]; onClose: () => void; onCreated: (item: Item) => void }) {
  const [form, setForm] = useState({ code: "", name: "", type: "component" as ItemType, uom_id: uoms[0]?.id ?? "", lot_tracked: false, serial_tracked: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code || !form.name || !form.uom_id) { setError("Code, Name, and UOM are required."); return; }
    setLoading(true);
    setError(null);
    try {
      const item = await createItem({ code: form.code, name: form.name, type: form.type, uom_id: form.uom_id, lot_tracked: form.lot_tracked, serial_tracked: form.serial_tracked });
      onCreated(item);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create item");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => onClose()}>
      <div className="w-full max-w-md rounded-md border border-line bg-paper shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">New Item</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-4 p-4">
          {error && <p className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Code *</label>
              <Input value={form.code} onChange={(e) => setForm(f => ({ ...f, code: e.target.value }))} placeholder="ITEM-001" required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Name *</label>
              <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Item name" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Type</label>
              <select value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value as ItemType }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15">
                {ITEM_TYPES.filter(t => t.value).map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">UOM *</label>
              <select value={form.uom_id} onChange={(e) => setForm(f => ({ ...f, uom_id: e.target.value }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15">
                {uoms.map(u => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={form.lot_tracked} onChange={(e) => setForm(f => ({ ...f, lot_tracked: e.target.checked }))} className="h-4 w-4 rounded border-line" />
              Lot Tracked
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={form.serial_tracked} onChange={(e) => setForm(f => ({ ...f, serial_tracked: e.target.checked }))} className="h-4 w-4 rounded border-line" />
              Serial Tracked
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={loading}>Create Item</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ItemsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [uoms, setUoms] = useState<UOM[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [uomMap, setUomMap] = useState<Map<string, UOM>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, uomList] = await Promise.all([
        listItems({ q, status: statusFilter, type: typeFilter, limit: 100 }),
        uoms.length === 0 ? listUoms() : Promise.resolve(uoms),
      ]);
      setItems(res.items);
      setTotal(res.total);
      if (uoms.length === 0) {
        setUoms(uomList);
        setUomMap(new Map(uomList.map(u => [u.id, u])));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load items");
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter, typeFilter, uoms]);

  useEffect(() => { void load(); }, [q, statusFilter, typeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  function exportCsv() {
    const header = "Code,Name,Type,Status,UOM,LotTracked,SerialTracked,Version\n";
    const rows = items.map(i => `"${i.code}","${i.name}","${i.type}","${i.status}","${uomMap.get(i.uomId)?.code ?? ""}",${i.lotTracked},${i.serialTracked},${i.version}`).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "items.csv";
    a.click();
  }

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Items" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New Item", variant: "primary", onClick: () => setShowNew(true) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
        { id: "export", label: "Export CSV", variant: "ghost", onClick: exportCsv },
      ]} />

      {/* Filters */}
      <div className="flex items-center gap-3 border-b border-line bg-paper px-4 py-2">
        <div className="flex gap-1">
          {STATUS_TABS.map(t => (
            <button key={t.value} onClick={() => setStatusFilter(t.value)}
              className={`rounded-xs px-3 py-1 text-xs font-medium transition-colors ${statusFilter === t.value ? "bg-accent text-white" : "text-ink-2 hover:bg-surface-2"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-line" />
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="h-8 rounded-sm border border-line bg-surface px-2 text-xs text-ink focus:border-accent focus:outline-none">
          {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items…" className="max-w-64 h-8 text-xs" />
        <span className="ml-auto text-xs text-ink-3">{total} items</span>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
        {loading && !items.length ? (
          <div className="flex h-32 items-center justify-center text-sm text-ink-3">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">UOM</th>
                <th className="px-4 py-2 text-center">Lot</th>
                <th className="px-4 py-2 text-center">Serial</th>
                <th className="px-4 py-2">Updated</th>
                <th className="px-4 py-2">v</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} onClick={() => router.push(`/mfg/items/${item.id}`)}
                  className="cursor-pointer border-b border-line hover:bg-surface-2">
                  <td className="px-4 py-2 font-mono text-xs uppercase text-ink">{item.code}</td>
                  <td className="px-4 py-2 font-medium text-ink">{item.name}</td>
                  <td className="px-4 py-2"><Tag tone={TYPE_TONES[item.type]}>{item.type}</Tag></td>
                  <td className="px-4 py-2"><Tag tone={STATUS_TONES[item.status]} dot>{item.status}</Tag></td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-2">{uomMap.get(item.uomId)?.code ?? "—"}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`inline-block h-2 w-2 rounded-full ${item.lotTracked ? "bg-success" : "bg-surface-2 border border-line"}`} />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span className={`inline-block h-2 w-2 rounded-full ${item.serialTracked ? "bg-success" : "bg-surface-2 border border-line"}`} />
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-3">{item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-2 text-xs text-ink-3">{item.version}</td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-ink-3">No items found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showNew && uoms.length > 0 && (
        <NewItemDialog uoms={uoms} onClose={() => setShowNew(false)} onCreated={(item) => { setShowNew(false); router.push(`/mfg/items/${item.id}`); }} />
      )}
    </div>
  );
}
