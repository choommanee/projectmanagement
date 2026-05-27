"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Tag } from "@pmplatform/ui-kit";
import { listItems, listBomsForItem, type Item, type BOMLine, type BOMHeader } from "@/lib/api/mfg";

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

/** Extract a numeric cost from item attrs (stored as standard_cost or standardCost) */
function getStdCost(item: Item): number {
  if (!item.attrs) return 0;
  const v =
    (item.attrs as Record<string, unknown>)["standard_cost"] ??
    (item.attrs as Record<string, unknown>)["standardCost"] ??
    (item.attrs as Record<string, unknown>)["unit_cost"] ??
    (item.attrs as Record<string, unknown>)["unitCost"];
  return typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) || 0 : 0;
}

/** Extract unit cost from a BOM line's extended attrs if available */
function getLineCost(line: BOMLine): number {
  if (!line.notes) return 0;
  // notes may carry JSON payload from some integrations; try to parse
  try {
    const parsed = JSON.parse(line.notes) as Record<string, unknown>;
    const v = parsed["unit_cost"] ?? parsed["unitCost"];
    return typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) || 0 : 0;
  } catch {
    return 0;
  }
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

        // Load default BOMs for all items
        const results = await Promise.allSettled(
          itemList.map((i) => listBomsForItem(i.id))
        );
        const map = new Map<string, { header: BOMHeader; lines: BOMLine[] }>();
        results.forEach((res, idx) => {
          if (res.status === "fulfilled" && res.value.length > 0) {
            // Prefer active/default BOM; fall back to first
            const header =
              res.value.find((b) => b.isDefault && b.status === "active") ??
              res.value.find((b) => b.status === "active") ??
              res.value[0];
            const lines = header.lines ?? [];
            if (lines.length > 0) {
              map.set(itemList[idx].id, { header, lines });
            }
          }
        });
        setBomMap(map);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const costs = useMemo((): ItemCost[] => {
    return items
      .map((item) => {
        const entry = bomMap.get(item.id);
        const lines = entry?.lines ?? [];
        const materialCost = lines.reduce((s, l) => s + getLineCost(l) * l.qty, 0);
        return {
          item,
          bomHeader: entry?.header ?? null,
          lines,
          materialCost,
          bomLineCount: lines.length,
        };
      })
      .filter((c) => c.bomLineCount > 0 || getStdCost(c.item) > 0);
  }, [items, bomMap]);

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
                    const unitCost = getLineCost(l);
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
                        {unitCost > 0 && (
                          <div className="text-right font-mono font-semibold">
                            = {fmt(unitCost * l.qty)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {selectedLines.some((l) => getLineCost(l) > 0) && (
                    <div className="border-t border-line pt-2 flex justify-between text-sm font-semibold">
                      <span>Total Material</span>
                      <span className="font-mono">
                        {fmt(
                          selectedLines.reduce((s, l) => s + getLineCost(l) * l.qty, 0)
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
