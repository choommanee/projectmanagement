"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal } from "lucide-react";
import { Button, Input } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { listInventory, type StockBalance } from "@/lib/api/inventory";
import { StockTransactionPanel } from "@/components/StockTransactionPanel";

export default function InventoryPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<StockBalance | null>(null);
  const [itemName, setItemName] = useState("");

  const {
    data: balances = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["inventory"],
    queryFn: listInventory,
  });

  const filtered = balances.filter(
    (b) =>
      !search ||
      b.itemId.toLowerCase().includes(search.toLowerCase()) ||
      b.lotNumber.toLowerCase().includes(search.toLowerCase()) ||
      b.location.toLowerCase().includes(search.toLowerCase())
  );

  function openTransaction(b: StockBalance) {
    setSelected(b);
    setItemName(b.itemId);
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
            onClick: () => refetch(),
          },
        ]}
      />

      {/* Filter bar */}
      <div className="flex items-center gap-3 border-b border-line px-4 py-2">
        <Input
          placeholder="Search item, lot, location…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <span className="ml-auto text-xs text-fgMuted">{filtered.length} records</span>
      </div>

      {/* Column headers */}
      <div className="flex border-b border-line bg-surface-2 px-4 py-1.5 text-xs font-medium text-fgMuted">
        <span className="flex-1">Item ID</span>
        <span className="w-32">Lot</span>
        <span className="w-32">Location</span>
        <span className="w-28 text-right">Qty on Hand</span>
        <span className="w-24 text-right">Updated</span>
        <span className="w-16" />
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
          <div className="flex flex-col items-center gap-2 py-16 text-fgMuted">
            <p className="text-sm">No inventory records. Post a Receive transaction to start.</p>
          </div>
        ) : (
          filtered.map((b) => (
            <div
              key={b.id}
              className="flex items-center border-b border-line px-4 py-2 text-sm hover:bg-surface-2 cursor-pointer"
              onClick={() => router.push('/mfg/items/' + b.itemId)}
            >
              <span className="flex-1 font-mono text-xs">{b.itemId.slice(0, 8)}…</span>
              <span className="w-32 text-xs text-fgMuted">{b.lotNumber || "—"}</span>
              <span className="w-32 text-xs text-fgMuted">{b.location}</span>
              <span
                className={`w-28 text-right font-mono text-sm font-semibold ${
                  b.qtyOnHand < 0
                    ? "text-danger"
                    : b.qtyOnHand === 0
                    ? "text-fgMuted"
                    : "text-fg"
                }`}
              >
                {b.qtyOnHand.toFixed(3)}
              </span>
              <span className="w-24 text-right text-xs text-fgMuted">
                {b.updatedAt ? new Date(b.updatedAt).toLocaleDateString() : "—"}
              </span>
              <div className="w-16 flex justify-end">
                <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openTransaction(b); }}>
                  <SlidersHorizontal size={13} />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {selected && (
        <StockTransactionPanel
          itemId={selected.itemId}
          itemName={itemName}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
