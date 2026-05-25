export interface StockBalance {
  id: string;
  itemId: string;
  lotNumber: string;
  location: string;
  qtyOnHand: number;
  updatedAt: string;
}

export interface InventoryTransaction {
  id: string;
  itemId: string;
  lotNumber: string;
  location: string;
  txnType: "receive" | "issue" | "adjust";
  qty: number;
  note: string;
  createdAt: string;
}

export async function listInventory(): Promise<StockBalance[]> {
  const res = await fetch("/api/mfg/inventory");
  if (!res.ok) throw new Error("Failed to fetch inventory");
  const data = await res.json();
  return (data.items ?? []).map(normBalance);
}

export async function postTransaction(params: {
  itemId: string;
  lotNumber: string;
  location: string;
  txnType: "receive" | "issue" | "adjust";
  qty: number;
  note: string;
  createdBy: string;
}): Promise<InventoryTransaction> {
  const res = await fetch("/api/mfg/inventory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      item_id: params.itemId,
      lot_number: params.lotNumber,
      location: params.location,
      txn_type: params.txnType,
      qty: params.qty,
      note: params.note,
      created_by: params.createdBy,
    }),
  });
  if (!res.ok) throw new Error("Failed to post transaction");
  return normTransaction(await res.json());
}

function normBalance(r: Record<string, unknown>): StockBalance {
  return {
    id: String(r["id"] ?? r["ID"] ?? ""),
    itemId: String(r["item_id"] ?? r["ItemID"] ?? r["itemId"] ?? ""),
    lotNumber: String(r["lot_number"] ?? r["LotNumber"] ?? r["lotNumber"] ?? ""),
    location: String(r["location"] ?? r["Location"] ?? "default"),
    qtyOnHand: Number(r["qty_on_hand"] ?? r["QtyOnHand"] ?? r["qtyOnHand"] ?? 0),
    updatedAt: String(r["updated_at"] ?? r["UpdatedAt"] ?? r["updatedAt"] ?? ""),
  };
}

function normTransaction(r: Record<string, unknown>): InventoryTransaction {
  return {
    id: String(r["id"] ?? r["ID"] ?? ""),
    itemId: String(r["item_id"] ?? r["ItemID"] ?? r["itemId"] ?? ""),
    lotNumber: String(
      r["lot_number"] ?? r["LotNumber"] ?? r["lotNumber"] ?? ""
    ),
    location: String(r["location"] ?? r["Location"] ?? "default"),
    txnType: String(
      r["txn_type"] ?? r["TxnType"] ?? r["txnType"] ?? "adjust"
    ) as InventoryTransaction["txnType"],
    qty: Number(r["qty"] ?? r["Qty"] ?? 0),
    note: String(r["note"] ?? r["Note"] ?? ""),
    createdAt: String(
      r["created_at"] ?? r["CreatedAt"] ?? r["createdAt"] ?? ""
    ),
  };
}
