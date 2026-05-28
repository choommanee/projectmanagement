"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button, Input, Tag, Dialog } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { listInventory, type StockBalance } from "@/lib/api/inventory";
import { getItem, updateItem, deleteItem, listUoms, type Item, type ItemStatus, type UOM } from "@/lib/api/mfg";
import { StockTransactionPanel } from "@/components/StockTransactionPanel";

const fieldCls = "h-9 w-full appearance-none rounded-sm border border-line bg-surface px-3 text-sm text-ink hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15";

// ── Edit Item Dialog ──────────────────────────────────────────────────────────

function EditItemDialog({ item, open, onClose, onSaved }: {
  item: Item | null; open: boolean; onClose: () => void; onSaved: (updated: Item) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ItemStatus>("active");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setName(item.name);
      setDescription(item.description);
      setStatus(item.status);
      setError(null);
    }
  }, [item]);

  async function submit() {
    if (!item) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await updateItem(item.id, { name, description, status, version: item.version });
      onSaved(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit item"
      description={item ? `Item ${item.code} — update name, description, status` : ""}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>Save</Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">Description</label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">Status</label>
          <select aria-label="Item status" value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)} className={fieldCls}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="obsolete">Obsolete</option>
          </select>
        </div>
      </div>
    </Dialog>
  );
}

// ── Delete Item Dialog ────────────────────────────────────────────────────────

function DeleteItemDialog({ item, open, onClose, onDeleted }: {
  item: Item | null; open: boolean; onClose: () => void; onDeleted: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (item) setError(null); }, [item]);

  async function submit() {
    if (!item) return;
    setLoading(true);
    setError(null);
    try {
      await deleteItem(item.id, item.version);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delete item"
      description="Permanently removes the item master record. Cannot be undone."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={loading} onClick={() => void submit()}>Delete item</Button>
        </>
      }
    >
      {item && (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            Delete <span className="font-mono font-semibold text-ink">{item.code}</span> — {item.name}?
            All stock balances for this item will also be removed.
          </p>
          {error && <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<StockBalance | null>(null);
  const [itemName, setItemName] = useState("");

  // Item cache: itemId → Item
  const [itemCache, setItemCache] = useState<Map<string, Item>>(new Map());

  // Edit / Delete targets
  const [editTarget, setEditTarget] = useState<Item | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);

  const {
    data: balances = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["inventory"],
    queryFn: listInventory,
  });

  // Load item metadata for each unique itemId
  useEffect(() => {
    const missing = [...new Set(balances.map(b => b.itemId))].filter(id => !itemCache.has(id));
    if (missing.length === 0) return;
    Promise.allSettled(missing.map(id => getItem(id))).then(results => {
      setItemCache(prev => {
        const next = new Map(prev);
        results.forEach((r, i) => {
          if (r.status === "fulfilled") next.set(missing[i], r.value);
        });
        return next;
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balances]);

  const filtered = balances.filter(
    (b) =>
      !search ||
      b.itemId.toLowerCase().includes(search.toLowerCase()) ||
      b.lotNumber.toLowerCase().includes(search.toLowerCase()) ||
      b.location.toLowerCase().includes(search.toLowerCase()) ||
      (itemCache.get(b.itemId)?.code ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (itemCache.get(b.itemId)?.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  function openTransaction(b: StockBalance) {
    setSelected(b);
    setItemName(itemCache.get(b.itemId)?.name ?? b.itemId);
  }

  async function openEdit(e: React.MouseEvent, b: StockBalance) {
    e.stopPropagation();
    const cached = itemCache.get(b.itemId);
    if (cached) { setEditTarget(cached); return; }
    try {
      const item = await getItem(b.itemId);
      setItemCache(prev => new Map(prev).set(b.itemId, item));
      setEditTarget(item);
    } catch { /* noop */ }
  }

  async function openDelete(e: React.MouseEvent, b: StockBalance) {
    e.stopPropagation();
    const cached = itemCache.get(b.itemId);
    if (cached) { setDeleteTarget(cached); return; }
    try {
      const item = await getItem(b.itemId);
      setItemCache(prev => new Map(prev).set(b.itemId, item));
      setDeleteTarget(item);
    } catch { /* noop */ }
  }

  function statusTone(s: ItemStatus): "success" | "warning" | "neutral" {
    if (s === "active") return "success";
    if (s === "inactive") return "warning";
    return "neutral";
  }

  return (
    <div className="flex flex-col h-full">
      <Breadcrumb
        items={[{ label: "Manufacturing Hub", href: "/mfg/home" }, { label: "Inventory" }]}
      />
      <CommandBar
        actions={[
          {
            id: "receive",
            label: "Receive",
            icon: <ArrowDownToLine size={14} />,
            onClick: () => {},
          },
          {
            id: "issue",
            label: "Issue",
            icon: <ArrowUpFromLine size={14} />,
            onClick: () => {},
          },
          {
            id: "refresh",
            label: "Refresh",
            icon: <RefreshCw size={14} />,
            onClick: () => void refetch(),
          },
        ]}
      />

      {/* Filter bar */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-2">
        <Input
          placeholder="Search item code, name, lot, location…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />
        <span className="ml-auto text-xs text-ink-3">{filtered.length} records</span>
      </div>

      {/* Column headers */}
      <div className="flex border-b border-line bg-surface-2 px-4 py-1.5 text-xs font-medium text-ink-3">
        <span className="w-40">Item Code</span>
        <span className="flex-1">Item Name</span>
        <span className="w-32">Lot</span>
        <span className="w-32">Location</span>
        <span className="w-28 text-right">Qty on Hand</span>
        <span className="w-24 text-right">Updated</span>
        <span className="w-28" />
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-px">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 animate-pulse border-b border-line bg-surface-2" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-ink-3">
            <p className="text-sm">No inventory records. Post a Receive transaction to start.</p>
          </div>
        ) : (
          filtered.map((b) => {
            const item = itemCache.get(b.itemId);
            return (
              <div
                key={b.id}
                className="flex items-center border-b border-line px-4 py-2 text-sm hover:bg-surface-2 cursor-pointer"
                onClick={() => router.push('/mfg/items/' + b.itemId)}
              >
                <span className="w-40 font-mono text-xs text-ink truncate">{item?.code ?? b.itemId.slice(0, 8) + "…"}</span>
                <span className="flex-1 text-xs text-ink-2 truncate pr-2">{item?.name ?? "—"}</span>
                <span className="w-32 text-xs text-ink-3">{b.lotNumber || "—"}</span>
                <span className="w-32 text-xs text-ink-3">{b.location}</span>
                <span
                  className={`w-28 text-right font-mono text-sm font-semibold ${
                    b.qtyOnHand < 0
                      ? "text-danger"
                      : b.qtyOnHand === 0
                      ? "text-ink-3"
                      : "text-ink"
                  }`}
                >
                  {b.qtyOnHand.toFixed(3)}
                </span>
                <span className="w-24 text-right text-xs text-ink-3">
                  {b.updatedAt ? new Date(b.updatedAt).toLocaleDateString() : "—"}
                </span>
                <div className="w-28 flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" aria-label="Stock transaction" onClick={(e) => { e.stopPropagation(); openTransaction(b); }}>
                    <SlidersHorizontal size={13} />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Edit item" onClick={(e) => void openEdit(e, b)}>
                    <Pencil size={13} />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Delete item" onClick={(e) => void openDelete(e, b)}>
                    <Trash2 size={13} className="text-danger" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {selected && (
        <StockTransactionPanel
          itemId={selected.itemId}
          itemName={itemName}
          onClose={() => setSelected(null)}
        />
      )}

      <EditItemDialog
        item={editTarget}
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={(updated) => {
          setItemCache(prev => new Map(prev).set(updated.id, updated));
          setEditTarget(null);
        }}
      />

      <DeleteItemDialog
        item={deleteTarget}
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          setDeleteTarget(null);
          void refetch();
          void queryClient.invalidateQueries({ queryKey: ["inventory"] });
        }}
      />
    </div>
  );
}
