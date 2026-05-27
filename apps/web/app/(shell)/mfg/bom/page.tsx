"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import { BomTree } from "@/components/BomTree";
import {
  listItems, listBomsForItem, createBomForItem, getBom, listUoms,
  type Item, type BOMHeader, type UOM,
} from "@/lib/api/mfg";

export default function BomExplorerPage() {
  const router = useRouter();
  const [itemQuery, setItemQuery] = useState("");
  const [itemResults, setItemResults] = useState<Item[]>([]);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [uoms, setUoms] = useState<UOM[]>([]);

  const [boms, setBoms] = useState<BOMHeader[]>([]);
  const [bomsLoading, setBomsLoading] = useState(false);
  const [bomsErr, setBomsErr] = useState<string | null>(null);

  const [selectedBom, setSelectedBom] = useState<BOMHeader | null>(null);
  const [selectedBomFull, setSelectedBomFull] = useState<BOMHeader | null>(null);
  const [bomDetailLoading, setBomDetailLoading] = useState(false);

  useEffect(() => {
    void listUoms().then(setUoms).catch(() => {});
  }, []);

  async function searchItem(q: string) {
    if (!q.trim()) { setItemResults([]); return; }
    try {
      const r = await listItems({ q, limit: 10 });
      setItemResults(r.items);
    } catch { setItemResults([]); }
  }

  function selectItem(item: Item) {
    setSelectedItem(item);
    setItemQuery(`${item.code} — ${item.name}`);
    setItemResults([]);
    setSelectedBom(null);
    setSelectedBomFull(null);
    void loadBoms(item.id);
  }

  const loadBoms = useCallback(async (itemId: string) => {
    setBomsLoading(true);
    setBomsErr(null);
    try {
      const list = await listBomsForItem(itemId);
      setBoms(list);
    } catch (err) {
      setBomsErr(err instanceof Error ? err.message : "Failed to load BOMs");
    } finally {
      setBomsLoading(false);
    }
  }, []);

  async function handleSelectBom(bom: BOMHeader) {
    setSelectedBom(bom);
    setSelectedBomFull(null);
    setBomDetailLoading(true);
    try {
      const bomWithLines = await getBom(bom.id);
      const lines = bomWithLines.lines ?? [];
      setSelectedBomFull({ ...bomWithLines, lines });
    } catch {
      setSelectedBomFull(bom);
    } finally {
      setBomDetailLoading(false);
    }
  }

  async function handleNewBomVersion() {
    if (!selectedItem) return;
    setBomsErr(null);
    try {
      const newBom = await createBomForItem(selectedItem.id);
      await loadBoms(selectedItem.id);
      void handleSelectBom(newBom);
    } catch (err) {
      setBomsErr(err instanceof Error ? err.message : "Failed to create BOM");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "BOM Explorer" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New BOM Version", variant: "primary", onClick: handleNewBomVersion, disabled: !selectedItem },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: () => selectedItem && loadBoms(selectedItem.id), disabled: !selectedItem },
      ]} />

      {/* Item picker */}
      <div className="border-b border-line bg-paper px-4 py-3">
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-ink-2 whitespace-nowrap">Select Item</label>
          <div className="relative w-80">
            <Input
              value={itemQuery}
              onChange={(e) => { setItemQuery(e.target.value); void searchItem(e.target.value); }}
              placeholder="Search by code or name…"
              className="h-9"
            />
            {itemResults.length > 0 && (
              <ul className="absolute left-0 top-full z-30 mt-1 w-full rounded-sm border border-line bg-surface shadow-pop">
                {itemResults.map(it => (
                  <li key={it.id}
                    className="cursor-pointer px-3 py-2 text-xs hover:bg-surface-2"
                    onClick={() => selectItem(it)}>
                    <span className="font-mono font-medium">{it.code}</span>
                    <span className="ml-2 text-ink-3">{it.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {selectedItem && (
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-ink">{selectedItem.code}</span>
              <span className="text-sm text-ink-2">{selectedItem.name}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setSelectedItem(null); setItemQuery(""); setBoms([]); setSelectedBom(null); setSelectedBomFull(null); }}>✕ Clear</Button>
            </div>
          )}
        </div>
      </div>

      {!selectedItem ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="w-full max-w-sm rounded-md border border-dashed border-line-strong bg-surface p-8 text-center">
            <span className="font-mono text-[11px] text-ink-3">No BOMs found for this filter.</span>
            <h2 className="mt-2 text-base font-semibold text-ink">Select an Item</h2>
            <p className="mt-1 text-sm text-ink-3">Use the search above to find a finished good or assembly to view its bill of materials.</p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left rail — BOM version list */}
          <div className="flex w-72 flex-col border-r border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">BOM Versions</span>
              <Button type="button" size="sm" variant="ghost" onClick={handleNewBomVersion}>+ New</Button>
            </div>
            {bomsErr && <p className="px-3 py-2 text-xs text-danger">{bomsErr}</p>}
            {bomsLoading ? (
              <div className="space-y-px p-1">
                {[1,2,3].map(i => (
                  <div key={i} className="h-14 animate-pulse rounded border-b border-border bg-surface-2" />
                ))}
              </div>
            ) : boms.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-ink-3">
                No BOMs. Create one with &quot;+ New&quot;.
              </div>
            ) : (
              <ul className="flex-1 overflow-auto">
                {boms.map(bom => (
                  <li key={bom.id}
                    className={`cursor-pointer border-b border-line px-3 py-2.5 hover:bg-surface-2 ${selectedBom?.id === bom.id ? "bg-accent-soft/20 border-l-2 border-l-accent" : ""}`}
                    onClick={() => { handleSelectBom(bom); router.push('/mfg/bom/' + bom.id); }}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold">v{bom.version}</span>
                      <Tag tone={bom.status === "active" ? "success" : "neutral"} dot>{bom.status}</Tag>
                    </div>
                    <div className="mt-1 flex gap-2">
                      {bom.isDefault && <Tag tone="accent">Default</Tag>}
                    </div>
                    {bom.effectiveFrom && (
                      <div className="mt-1 text-[10px] text-ink-3">From {new Date(bom.effectiveFrom).toLocaleDateString()}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Right pane — BOM tree */}
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {!selectedBom && (
              <div className="flex h-full items-center justify-center text-sm text-ink-3">
                Select a BOM version from the left panel.
              </div>
            )}
            {selectedBom && bomDetailLoading && (
              <div className="space-y-2">
                {[1,2,3,4].map(i => (
                  <div key={i} className="h-8 animate-pulse rounded border border-border bg-surface-2" />
                ))}
              </div>
            )}
            {selectedBomFull && !bomDetailLoading && (
              <BomTree
                bom={selectedBomFull}
                uoms={uoms}
                onChange={() => selectedItem && loadBoms(selectedItem.id)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
