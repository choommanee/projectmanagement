"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Tag } from "@pmplatform/ui-kit";
import { listItems, listBomsForItem, getBom, type Item, type BOMLine, type BOMHeader } from "@/lib/api/mfg";

interface ItemCost {
  item: Item;
  bomHeader: BOMHeader | null;
  lines: BOMLine[];
  materialCost: number;
  bomLineCount: number;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Standard cost is stored on the item's `attrs` (Items → attributes). This is
 * the only cost source modelled by mfg-svc today; there is no first-class
 * standard-cost column or routing labor rate (see page banner).
 */
function getStdCost(item: Item | undefined): number {
  if (!item || !item.attrs) return 0;
  const a = item.attrs as Record<string, unknown>;
  const v = a["standard_cost"] ?? a["standardCost"] ?? a["unit_cost"] ?? a["unitCost"];
  return typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) || 0 : 0;
}

/**
 * Real single-level material cost for one BOM line: the child component's
 * standard cost × required quantity (scrap-adjusted). Components without a
 * standard cost contribute 0 — surfaced honestly rather than fabricated.
 */
function lineMaterialCost(line: BOMLine, itemsById: Map<string, Item>): number {
  const child = itemsById.get(line.childItemId);
  const unit = getStdCost(child);
  const effectiveQty = line.qty * (1 + (line.scrapPct || 0) / 100);
  return unit * effectiveQty;
}

export default function ItemCostingPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [bomMap, setBomMap] = useState<Map<string, { header: BOMHeader; lines: BOMLine[] }>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Item | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    listItems({ limit: 200 })
      .then(async ({ items: itemList }) => {
        setItems(itemList);

        // Load default BOM headers for all items. The list endpoint does not
        // embed lines, so fetch the chosen BOM's detail (getBom) to obtain them
        // — same pattern the BOM page uses.
        const results = await Promise.allSettled(
          itemList.map((i) => listBomsForItem(i.id))
        );
        const headerByItem = new Map<string, BOMHeader>();
        results.forEach((res, idx) => {
          if (res.status === "fulfilled" && res.value.length > 0) {
            const header =
              res.value.find((b) => b.isDefault && b.status === "active") ??
              res.value.find((b) => b.status === "active") ??
              res.value[0];
            headerByItem.set(itemList[idx].id, header);
          }
        });
        const detailResults = await Promise.allSettled(
          Array.from(headerByItem.entries()).map(async ([itemId, header]) => {
            const full = await getBom(header.id);
            return [itemId, full] as const;
          })
        );
        const map = new Map<string, { header: BOMHeader; lines: BOMLine[] }>();
        for (const res of detailResults) {
          if (res.status === "fulfilled") {
            const [itemId, full] = res.value;
            const lines = full.lines ?? [];
            if (lines.length > 0) map.set(itemId, { header: full, lines });
          }
        }
        setBomMap(map);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const itemsById = useMemo(() => {
    const m = new Map<string, Item>();
    for (const i of items) m.set(i.id, i);
    return m;
  }, [items]);

  const costs = useMemo((): ItemCost[] => {
    return items
      .map((item) => {
        const entry = bomMap.get(item.id);
        const lines = entry?.lines ?? [];
        const materialCost = lines.reduce((s, l) => s + lineMaterialCost(l, itemsById), 0);
        return {
          item,
          bomHeader: entry?.header ?? null,
          lines,
          materialCost,
          bomLineCount: lines.length,
        };
      })
      .filter((c) => c.bomLineCount > 0 || getStdCost(c.item) > 0);
  }, [items, bomMap, itemsById]);

  const filtered = useMemo(
    () =>
      costs.filter(
        (c) =>
          !search ||
          c.item.name.toLowerCase().includes(search.toLowerCase()) ||
          c.item.code.toLowerCase().includes(search.toLowerCase())
      ),
    [costs, search]
  );

  const selectedEntry = selected ? bomMap.get(selected.id) : undefined;
  const selectedLines = selectedEntry?.lines ?? [];
  const selectedStdCost = selected ? getStdCost(selected) : 0;

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "MFG", href: "/mfg/home" }, { label: "Item Costing" }]} />
      <h1 className="text-xl font-semibold">Item Costing Worksheet</h1>

      <div className="rounded border border-info/30 bg-info/10 px-3 py-2 text-xs text-ink-2">
        Material cost is a single-level roll-up: each component&apos;s standard cost
        (set per item in Items → attributes) × scrap-adjusted quantity from the
        active BOM. Components without a standard cost contribute 0.
        Routing / labor and multi-level (sub-assembly) costs are not yet modelled
        in the backend, so this worksheet reflects direct material only.
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search items…"
        className="max-w-xs rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
      />

      {loading ? (
        <p className="text-sm text-ink-3">Loading items and BOMs…</p>
      ) : (
        <div className="flex gap-4">
          {/* Item list */}
          <div className="flex-1 overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-ink-3">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Code</th>
                  <th className="px-4 py-2 text-left font-medium">Name</th>
                  <th className="px-4 py-2 text-left font-medium">Type</th>
                  <th className="px-4 py-2 text-right font-medium">BOM Lines</th>
                  <th className="px-4 py-2 text-right font-medium">Material Cost</th>
                  <th className="px-4 py-2 text-right font-medium">Standard Cost</th>
                  <th className="px-4 py-2 text-right font-medium">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-ink-3">
                      No items with BOM data or standard cost.
                    </td>
                  </tr>
                ) : (
                  filtered.map(({ item, materialCost, bomLineCount }) => {
                    const stdCost = getStdCost(item);
                    const variance = stdCost - materialCost;
                    return (
                      <tr
                        key={item.id}
                        onClick={() =>
                          setSelected(selected?.id === item.id ? null : item)
                        }
                        className={`cursor-pointer hover:bg-surface-2/50 ${
                          selected?.id === item.id
                            ? "bg-accent/5 border-l-2 border-l-accent"
                            : ""
                        }`}
                      >
                        <td className="px-4 py-2 font-mono text-xs">{item.code}</td>
                        <td className="px-4 py-2 font-medium">{item.name}</td>
                        <td className="px-4 py-2">
                          <Tag tone="neutral" size="sm">
                            {item.type}
                          </Tag>
                        </td>
                        <td className="px-4 py-2 text-right font-mono">{bomLineCount}</td>
                        <td className="px-4 py-2 text-right font-mono">{fmt(materialCost)}</td>
                        <td className="px-4 py-2 text-right font-mono">{fmt(stdCost)}</td>
                        <td
                          className={`px-4 py-2 text-right font-mono font-semibold ${
                            variance >= 0 ? "text-success" : "text-danger"
                          }`}
                        >
                          {variance >= 0 ? "+" : ""}
                          {fmt(variance)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* BOM detail panel */}
          {selected && (
            <div className="w-80 flex-shrink-0 rounded-lg border border-line bg-surface p-4">
              <div className="mb-3 flex items-start justify-between gap-2">
                <h3 className="font-semibold text-sm leading-tight">{selected.name} — BOM</h3>
                <button
                  onClick={() => setSelected(null)}
                  className="text-ink-3 hover:text-ink text-xs flex-shrink-0"
                >
                  ✕
                </button>
              </div>
              {selectedEntry?.header && (
                <p className="text-xs text-ink-3 mb-2">
                  BOM v{selectedEntry.header.version} ·{" "}
                  <span className="capitalize">{selectedEntry.header.status}</span>
                </p>
              )}
              {selectedLines.length === 0 ? (
                <p className="text-xs text-ink-3">No BOM lines loaded.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {selectedLines.map((l, i) => {
                    const unitCost = getStdCost(itemsById.get(l.childItemId));
                    const lineTotal = lineMaterialCost(l, itemsById);
                    return (
                      <div
                        key={l.id || i}
                        className="flex flex-col gap-0.5 rounded border border-line bg-surface-2 px-3 py-2 text-xs"
                      >
                        <span className="font-medium font-mono">{l.childItemId}</span>
                        <div className="flex justify-between text-ink-3">
                          <span>
                            Qty: {l.qty}
                            {l.scrapPct > 0 && (
                              <span className="ml-1 text-warning">(+{l.scrapPct}% scrap)</span>
                            )}
                          </span>
                          {unitCost > 0 && <span>Unit cost: {fmt(unitCost)}</span>}
                        </div>
                        {lineTotal > 0 && (
                          <div className="text-right font-mono font-semibold">
                            = {fmt(lineTotal)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {selectedLines.some((l) => lineMaterialCost(l, itemsById) > 0) && (
                    <div className="border-t border-line pt-2 flex justify-between text-sm font-semibold">
                      <span>Total Material</span>
                      <span className="font-mono">
                        {fmt(
                          selectedLines.reduce((s, l) => s + lineMaterialCost(l, itemsById), 0)
                        )}
                      </span>
                    </div>
                  )}
                  {selectedStdCost > 0 && (
                    <div className="flex justify-between text-sm text-ink-3">
                      <span>Standard Cost</span>
                      <span className="font-mono">{fmt(selectedStdCost)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
