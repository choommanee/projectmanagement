"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button, Input } from "@pmplatform/ui-kit";
import { postTransaction } from "@/lib/api/inventory";
import { listItems, type Item } from "@/lib/api/mfg";
import { useAuth } from "@/lib/auth/AuthProvider";

interface Props {
  /** Pre-selected item. When omitted the panel renders an item picker. */
  itemId?: string;
  itemName?: string;
  /** Optional preset transaction type (used by the global Receive/Issue actions). */
  initialTxnType?: TxnType;
  onClose: () => void;
}

type TxnType = "receive" | "issue" | "adjust";

export function StockTransactionPanel({ itemId, itemName, initialTxnType, onClose }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [txnType, setTxnType] = useState<TxnType>(initialTxnType ?? "receive");
  const [qty, setQty] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [location, setLocation] = useState("default");
  const [note, setNote] = useState("");

  // Item picker (only used when no itemId was passed in).
  const [pickedItemId, setPickedItemId] = useState("");
  const [pickedItemName, setPickedItemName] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [itemResults, setItemResults] = useState<Item[]>([]);

  const effectiveItemId = itemId ?? pickedItemId;

  async function searchItem(q: string) {
    if (!q.trim()) { setItemResults([]); return; }
    try { const r = await listItems({ q, limit: 10 }); setItemResults(r.items); } catch { /* noop */ }
  }

  const mutation = useMutation({
    mutationFn: () =>
      postTransaction({
        itemId: effectiveItemId,
        lotNumber,
        location,
        note,
        txnType,
        qty: parseFloat(qty),
        createdBy: user?.id ?? "",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      onClose();
    },
  });

  const txnTypes: Array<{ value: TxnType; label: string; activeClass: string }> = [
    { value: "receive", label: "Receive", activeClass: "bg-success/10 text-success border-success/30" },
    { value: "issue",   label: "Issue",   activeClass: "bg-danger/10 text-danger border-danger/30"   },
    { value: "adjust",  label: "Adjust",  activeClass: "bg-warning/10 text-warning border-warning/30" },
  ];

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-96 flex-col bg-surface shadow-xl border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Stock Transaction</p>
          <p className="text-xs text-fgMuted">{itemName ?? pickedItemName ?? "Select an item"}</p>
        </div>
        <button onClick={onClose} className="text-fgMuted hover:text-fg">
          <X size={18} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Item picker (only when no item was pre-selected) */}
        {!itemId && (
          <div>
            <label className="mb-1 block text-xs font-medium text-fgMuted">Item *</label>
            <div className="relative">
              <Input
                placeholder="Search item code or name…"
                value={itemQuery}
                onChange={(e) => { setItemQuery(e.target.value); void searchItem(e.target.value); }}
              />
              {itemResults.length > 0 && (
                <ul className="absolute left-0 top-full z-30 mt-1 w-full rounded-sm border border-line bg-surface shadow-pop">
                  {itemResults.map((it) => (
                    <li
                      key={it.id}
                      className="cursor-pointer px-3 py-1.5 text-xs hover:bg-surface-2"
                      onClick={() => {
                        setPickedItemId(it.id);
                        setPickedItemName(`${it.code} — ${it.name}`);
                        setItemQuery(`${it.code} — ${it.name}`);
                        setItemResults([]);
                      }}
                    >
                      <span className="font-mono">{it.code}</span> — {it.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Transaction type */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fgMuted uppercase tracking-wide">
            Transaction Type
          </label>
          <div className="flex gap-2">
            {txnTypes.map((t) => (
              <button
                key={t.value}
                onClick={() => setTxnType(t.value)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-all
                  ${txnType === t.value ? t.activeClass : "border-border text-fgMuted hover:text-fg"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-fgMuted">Quantity *</label>
          <Input
            type="number"
            min="0.001"
            step="0.001"
            placeholder="0.000"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-fgMuted">Lot Number</label>
          <Input
            placeholder="LOT-001 (optional)"
            value={lotNumber}
            onChange={(e) => setLotNumber(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-fgMuted">Location</label>
          <Input
            placeholder="default"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-fgMuted">Note</label>
          <Input
            placeholder="PO#, WO# or description"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {mutation.isError && (
          <p className="text-sm text-danger">{String(mutation.error)}</p>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={
            !effectiveItemId || !qty || isNaN(parseFloat(qty)) || parseFloat(qty) <= 0 || mutation.isPending
          }
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Posting…" : "Post Transaction"}
        </Button>
      </div>
    </div>
  );
}
