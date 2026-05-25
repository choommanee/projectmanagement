# Plan #11 — Inventory Management

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inventory management to the Manufacturing Hub — stock items, stock transactions (receive/issue/adjust), lot-level stock balances, and a simple inventory list + transaction history UI.

**Architecture:** Extend `mfg-svc` (port 8085) with a new `inventory_transaction` table that records stock movements. Stock balance is a materialized view over transactions. Frontend adds `/mfg/inventory` list page and a stock transaction slide-over. Dynamics 365 UI mandate applies.

**Tech Stack:** Go chi + pgx, Goose migration on `infra/migrations/mfg/`, Next.js 15 App Router, TanStack Query.

---

## File Map

```
New (Migration):
  infra/migrations/mfg/00006_inventory.sql

New / Modified (Go — mfg-svc):
  services/mfg-svc/internal/domain/inventory.go      new file — types
  services/mfg-svc/internal/store/inventory_store.go new file — store
  services/mfg-svc/internal/api/inventory_handlers.go new file — handlers
  services/mfg-svc/internal/api/handlers.go          register inventory routes

New (Frontend proxy):
  apps/web/app/api/mfg/inventory/route.ts             GET (list) + POST (transaction)
  apps/web/app/api/mfg/inventory/[itemId]/route.ts    GET stock balance for item

New (Frontend lib):
  apps/web/src/lib/api/inventory.ts                   listInventory / postTransaction / getItemStock

New (Frontend components):
  apps/web/src/components/StockTransactionPanel.tsx   slide-over for receive/issue/adjust

New (Frontend page):
  apps/web/app/(shell)/mfg/inventory/page.tsx         Inventory list

Modified:
  apps/web/src/lib/mock/apps.ts                       add Inventory nav under MFG hub
```

---

### Task A — Inventory migration

**Files:**
- Create: `infra/migrations/mfg/00006_inventory.sql`

- [ ] **Step 1: Write migration**

```sql
-- +goose Up

-- stock_balance: one row per (tenant, item, lot, location)
CREATE TABLE IF NOT EXISTS stock_balance (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  item_id      UUID NOT NULL REFERENCES item(id)   ON DELETE CASCADE,
  lot_number   TEXT NOT NULL DEFAULT '',
  location     TEXT NOT NULL DEFAULT 'default',
  qty_on_hand  NUMERIC(14,4) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, item_id, lot_number, location)
);

ENABLE ROW LEVEL SECURITY ON stock_balance;
ALTER TABLE stock_balance FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_balance
  USING (tenant_id = current_tenant_uuid());

CREATE INDEX ix_stock_balance_item ON stock_balance (tenant_id, item_id);

-- inventory_transaction: immutable ledger
CREATE TABLE IF NOT EXISTS inventory_transaction (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  item_id      UUID NOT NULL REFERENCES item(id)   ON DELETE CASCADE,
  lot_number   TEXT NOT NULL DEFAULT '',
  location     TEXT NOT NULL DEFAULT 'default',
  txn_type     TEXT NOT NULL CHECK (txn_type IN ('receive','issue','adjust')),
  qty          NUMERIC(14,4) NOT NULL,
  ref_type     TEXT NOT NULL DEFAULT '',
  ref_id       UUID,
  note         TEXT NOT NULL DEFAULT '',
  created_by   UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ENABLE ROW LEVEL SECURITY ON inventory_transaction;
ALTER TABLE inventory_transaction FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_transaction
  USING (tenant_id = current_tenant_uuid());

CREATE INDEX ix_inv_txn_item ON inventory_transaction (tenant_id, item_id);
CREATE INDEX ix_inv_txn_date ON inventory_transaction (tenant_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS inventory_transaction;
DROP TABLE IF EXISTS stock_balance;
```

- [ ] **Step 2: Run migration**

```bash
tools/scripts/migrate.sh up mfg
```

Expected: `goose: successfully migrated database to version 6`

- [ ] **Step 3: Commit**

```bash
git add infra/migrations/mfg/00006_inventory.sql
git commit -m "feat(mfg): inventory tables — stock_balance + inventory_transaction (Plan #11 Task A)"
```

---

### Task B — Inventory domain types + store

**Files:**
- Create: `services/mfg-svc/internal/domain/inventory.go`
- Create: `services/mfg-svc/internal/store/inventory_store.go`

- [ ] **Step 1: Create domain types**

Create `services/mfg-svc/internal/domain/inventory.go`:

```go
package domain

import (
	"time"
	"github.com/google/uuid"
)

type TxnType string

const (
	TxnReceive TxnType = "receive"
	TxnIssue   TxnType = "issue"
	TxnAdjust  TxnType = "adjust"
)

type StockBalance struct {
	ID         uuid.UUID
	TenantID   uuid.UUID
	ItemID     uuid.UUID
	LotNumber  string
	Location   string
	QtyOnHand  float64
	UpdatedAt  time.Time
}

type InventoryTransaction struct {
	ID         uuid.UUID
	TenantID   uuid.UUID
	ItemID     uuid.UUID
	LotNumber  string
	Location   string
	TxnType    TxnType
	Qty        float64
	RefType    string
	RefID      *uuid.UUID
	Note       string
	CreatedBy  uuid.UUID
	CreatedAt  time.Time
}

type PostTransactionParams struct {
	ItemID    uuid.UUID
	LotNumber string
	Location  string
	TxnType   TxnType
	Qty       float64
	RefType   string
	RefID     *uuid.UUID
	Note      string
	CreatedBy uuid.UUID
}
```

- [ ] **Step 2: Create inventory store**

Create `services/mfg-svc/internal/store/inventory_store.go`:

```go
package store

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	libdb "github.com/your-org/pm-platform/libs/go/db"

	"mfg-svc/internal/domain"
)

type InventoryStore struct{ pool *pgxpool.Pool }

func NewInventoryStore(pool *pgxpool.Pool) *InventoryStore {
	return &InventoryStore{pool: pool}
}

func (s *InventoryStore) ListBalances(ctx context.Context, tenantID uuid.UUID) ([]domain.StockBalance, error) {
	ctx = libdb.WithTenant(ctx, tenantID)
	rows, err := s.pool.Query(ctx,
		`SELECT id, tenant_id, item_id, lot_number, location, qty_on_hand, updated_at
		 FROM stock_balance ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.StockBalance
	for rows.Next() {
		var b domain.StockBalance
		if err := rows.Scan(&b.ID, &b.TenantID, &b.ItemID, &b.LotNumber,
			&b.Location, &b.QtyOnHand, &b.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *InventoryStore) GetItemBalance(ctx context.Context, tenantID, itemID uuid.UUID) ([]domain.StockBalance, error) {
	ctx = libdb.WithTenant(ctx, tenantID)
	rows, err := s.pool.Query(ctx,
		`SELECT id, tenant_id, item_id, lot_number, location, qty_on_hand, updated_at
		 FROM stock_balance WHERE item_id = $1`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.StockBalance
	for rows.Next() {
		var b domain.StockBalance
		if err := rows.Scan(&b.ID, &b.TenantID, &b.ItemID, &b.LotNumber,
			&b.Location, &b.QtyOnHand, &b.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// PostTransaction records a movement and updates stock_balance atomically.
func (s *InventoryStore) PostTransaction(ctx context.Context, tenantID uuid.UUID, p domain.PostTransactionParams) (domain.InventoryTransaction, error) {
	ctx = libdb.WithTenant(ctx, tenantID)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.InventoryTransaction{}, err
	}
	defer tx.Rollback(ctx)

	// qty delta: receive/adjust can be positive or negative; issue is always negative
	delta := p.Qty
	if p.TxnType == domain.TxnIssue {
		delta = -p.Qty
	}

	// upsert balance
	_, err = tx.Exec(ctx, `
		INSERT INTO stock_balance (tenant_id, item_id, lot_number, location, qty_on_hand, updated_at)
		VALUES ($1,$2,$3,$4,$5,now())
		ON CONFLICT (tenant_id, item_id, lot_number, location)
		DO UPDATE SET qty_on_hand = stock_balance.qty_on_hand + $5, updated_at = now()`,
		tenantID, p.ItemID, p.LotNumber, p.Location, delta)
	if err != nil {
		return domain.InventoryTransaction{}, err
	}

	// insert ledger row
	var t domain.InventoryTransaction
	err = tx.QueryRow(ctx, `
		INSERT INTO inventory_transaction
		  (tenant_id, item_id, lot_number, location, txn_type, qty, ref_type, ref_id, note, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING id, tenant_id, item_id, lot_number, location, txn_type, qty,
		          ref_type, ref_id, note, created_by, created_at`,
		tenantID, p.ItemID, p.LotNumber, p.Location, string(p.TxnType), p.Qty,
		p.RefType, p.RefID, p.Note, p.CreatedBy,
	).Scan(&t.ID, &t.TenantID, &t.ItemID, &t.LotNumber, &t.Location,
		(*string)(&t.TxnType), &t.Qty, &t.RefType, &t.RefID, &t.Note,
		&t.CreatedBy, &t.CreatedAt)
	if err != nil {
		return domain.InventoryTransaction{}, err
	}

	return t, tx.Commit(ctx)
}

func (s *InventoryStore) ListTransactions(ctx context.Context, tenantID, itemID uuid.UUID) ([]domain.InventoryTransaction, error) {
	ctx = libdb.WithTenant(ctx, tenantID)
	rows, err := s.pool.Query(ctx, `
		SELECT id, tenant_id, item_id, lot_number, location, txn_type, qty,
		       ref_type, ref_id, note, created_by, created_at
		FROM inventory_transaction WHERE item_id = $1
		ORDER BY created_at DESC LIMIT 200`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.InventoryTransaction
	for rows.Next() {
		var t domain.InventoryTransaction
		if err := rows.Scan(&t.ID, &t.TenantID, &t.ItemID, &t.LotNumber, &t.Location,
			(*string)(&t.TxnType), &t.Qty, &t.RefType, &t.RefID, &t.Note,
			&t.CreatedBy, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
```

- [ ] **Step 3: Wire InventoryStore into mfg-svc Service struct**

Find the main Service struct in `services/mfg-svc/internal/service/` and add:
```go
Inventory *store.InventoryStore
```

In `cmd/server/main.go`, add after pool is initialized:
```go
svc.Inventory = store.NewInventoryStore(pool)
```

- [ ] **Step 4: Run existing tests (no regressions)**

```bash
cd services/mfg-svc && go test ./...
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add services/mfg-svc/
git commit -m "feat(mfg-svc): inventory domain + store (Plan #11 Task B)"
```

---

### Task C — Inventory API handlers

**Files:**
- Create: `services/mfg-svc/internal/api/inventory_handlers.go`
- Modify: `services/mfg-svc/internal/api/handlers.go` (register routes)

- [ ] **Step 1: Create inventory handlers**

Create `services/mfg-svc/internal/api/inventory_handlers.go`:

```go
package api

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"mfg-svc/internal/domain"
)

// GET /v1/inventory
func listInventory(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid := tenantID(r)
		balances, err := svc.Inventory.ListBalances(r.Context(), tid)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if balances == nil {
			balances = []domain.StockBalance{}
		}
		writeJSON(w, 200, map[string]any{"items": balances, "total": len(balances)})
	}
}

// GET /v1/inventory/items/{itemId}/balance
func getItemBalance(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid := tenantID(r)
		itemID, err := uuid.Parse(chi.URLParam(r, "itemId"))
		if err != nil {
			http.Error(w, "invalid item id", http.StatusBadRequest)
			return
		}
		balances, err := svc.Inventory.GetItemBalance(r.Context(), tid, itemID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if balances == nil {
			balances = []domain.StockBalance{}
		}
		writeJSON(w, 200, map[string]any{"items": balances})
	}
}

// POST /v1/inventory/transactions
func postInventoryTransaction(svc *service.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tid := tenantID(r)
		var req struct {
			ItemID    string  `json:"item_id"`
			LotNumber string  `json:"lot_number"`
			Location  string  `json:"location"`
			TxnType   string  `json:"txn_type"`
			Qty       float64 `json:"qty"`
			Note      string  `json:"note"`
			CreatedBy string  `json:"created_by"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		itemID, err := uuid.Parse(req.ItemID)
		if err != nil {
			http.Error(w, "invalid item_id", http.StatusBadRequest)
			return
		}
		createdBy, err := uuid.Parse(req.CreatedBy)
		if err != nil {
			http.Error(w, "invalid created_by", http.StatusBadRequest)
			return
		}
		if req.Qty <= 0 {
			http.Error(w, "qty must be > 0", http.StatusBadRequest)
			return
		}
		txnType := domain.TxnType(req.TxnType)
		if txnType != domain.TxnReceive && txnType != domain.TxnIssue && txnType != domain.TxnAdjust {
			http.Error(w, "txn_type must be receive|issue|adjust", http.StatusBadRequest)
			return
		}
		txn, err := svc.Inventory.PostTransaction(r.Context(), tid, domain.PostTransactionParams{
			ItemID:    itemID,
			LotNumber: req.LotNumber,
			Location:  req.Location,
			TxnType:   txnType,
			Qty:       req.Qty,
			Note:      req.Note,
			CreatedBy: createdBy,
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		writeJSON(w, 201, txn)
	}
}
```

- [ ] **Step 2: Register routes**

In `services/mfg-svc/internal/api/handlers.go`, in the v1 router block, add:

```go
r.Get("/inventory", listInventory(svc))
r.Get("/inventory/items/{itemId}/balance", getItemBalance(svc))
r.With(libauth.RequireAction(authz, "mfg.inventory.post", "*")).
    Post("/inventory/transactions", postInventoryTransaction(svc))
```

- [ ] **Step 3: Add Cedar action**

In `libs/policy/bundle.cedar`, add:

```
permit(
  principal in Role::"mfg-operator",
  action == Action::"mfg.inventory.post",
  resource == Resource::"*"
);
```

In `docs/adr/0002-cedar-actions.md`, add a row for `mfg.inventory.post`.

- [ ] **Step 4: Run tests**

```bash
cd services/mfg-svc && go test ./...
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add services/mfg-svc/ libs/policy/bundle.cedar docs/adr/
git commit -m "feat(mfg-svc): inventory API handlers (Plan #11 Task C)"
```

---

### Task D — Frontend proxy routes

**Files:**
- Create: `apps/web/app/api/mfg/inventory/route.ts`
- Create: `apps/web/app/api/mfg/inventory/[itemId]/route.ts`
- Create: `apps/web/src/lib/api/inventory.ts`

- [ ] **Step 1: Create proxy routes**

Create `apps/web/app/api/mfg/inventory/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { mfgProxy } from "../_proxy";

export async function GET(req: NextRequest) {
  return mfgProxy(req, "/v1/inventory");
}

export async function POST(req: NextRequest) {
  return mfgProxy(req, "/v1/inventory/transactions", "POST", await req.json());
}
```

Create `apps/web/app/api/mfg/inventory/[itemId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { mfgProxy } from "../../_proxy";

export async function GET(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  return mfgProxy(req, `/v1/inventory/items/${itemId}/balance`);
}
```

- [ ] **Step 2: Create inventory API client**

Create `apps/web/src/lib/api/inventory.ts`:

```typescript
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
  itemId: string; lotNumber: string; location: string;
  txnType: "receive" | "issue" | "adjust"; qty: number; note: string; createdBy: string;
}): Promise<InventoryTransaction> {
  const res = await fetch("/api/mfg/inventory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      item_id:    params.itemId,
      lot_number: params.lotNumber,
      location:   params.location,
      txn_type:   params.txnType,
      qty:        params.qty,
      note:       params.note,
      created_by: params.createdBy,
    }),
  });
  if (!res.ok) throw new Error("Failed to post transaction");
  return normTransaction(await res.json());
}

function normBalance(r: Record<string, unknown>): StockBalance {
  return {
    id:         String(r["id"] ?? r["ID"] ?? ""),
    itemId:     String(r["item_id"] ?? r["ItemID"] ?? r["itemId"] ?? ""),
    lotNumber:  String(r["lot_number"] ?? r["LotNumber"] ?? r["lotNumber"] ?? ""),
    location:   String(r["location"] ?? r["Location"] ?? "default"),
    qtyOnHand:  Number(r["qty_on_hand"] ?? r["QtyOnHand"] ?? r["qtyOnHand"] ?? 0),
    updatedAt:  String(r["updated_at"] ?? r["UpdatedAt"] ?? r["updatedAt"] ?? ""),
  };
}

function normTransaction(r: Record<string, unknown>): InventoryTransaction {
  return {
    id:        String(r["id"] ?? r["ID"] ?? ""),
    itemId:    String(r["item_id"] ?? r["ItemID"] ?? r["itemId"] ?? ""),
    lotNumber: String(r["lot_number"] ?? r["LotNumber"] ?? r["lotNumber"] ?? ""),
    location:  String(r["location"] ?? r["Location"] ?? "default"),
    txnType:   String(r["txn_type"] ?? r["TxnType"] ?? r["txnType"] ?? "adjust") as InventoryTransaction["txnType"],
    qty:       Number(r["qty"] ?? r["Qty"] ?? 0),
    note:      String(r["note"] ?? r["Note"] ?? ""),
    createdAt: String(r["created_at"] ?? r["CreatedAt"] ?? r["createdAt"] ?? ""),
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/mfg/inventory/ apps/web/src/lib/api/inventory.ts
git commit -m "feat(web): inventory proxy routes + API client (Plan #11 Task D)"
```

---

### Task E — Inventory list page + StockTransactionPanel

**Files:**
- Create: `apps/web/app/(shell)/mfg/inventory/page.tsx`
- Create: `apps/web/src/components/StockTransactionPanel.tsx`
- Modify: `apps/web/src/lib/mock/apps.ts`

- [ ] **Step 1: Create StockTransactionPanel**

Create `apps/web/src/components/StockTransactionPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button, Input } from "@pmplatform/ui-kit";
import { postTransaction } from "@/lib/api/inventory";
import { useAuth } from "@/lib/auth/AuthProvider";

interface Props {
  itemId: string;
  itemName: string;
  onClose: () => void;
}

type TxnType = "receive" | "issue" | "adjust";

export function StockTransactionPanel({ itemId, itemName, onClose }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [txnType, setTxnType] = useState<TxnType>("receive");
  const [qty, setQty] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [location, setLocation] = useState("default");
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      postTransaction({
        itemId, lotNumber, location, note,
        txnType,
        qty: parseFloat(qty),
        createdBy: user?.id ?? "",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory"] });
      onClose();
    },
  });

  const txnTypes: Array<{ value: TxnType; label: string; color: string }> = [
    { value: "receive", label: "Receive", color: "bg-success/10 text-success border-success/30" },
    { value: "issue",   label: "Issue",   color: "bg-danger/10 text-danger border-danger/30"   },
    { value: "adjust",  label: "Adjust",  color: "bg-warning/10 text-warning border-warning/30" },
  ];

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-96 flex-col bg-surface shadow-xl border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-semibold">Stock Transaction</p>
          <p className="text-xs text-fgMuted">{itemName}</p>
        </div>
        <button onClick={onClose} className="text-fgMuted hover:text-fg">
          <X size={18} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
                  ${txnType === t.value ? t.color : "border-border text-fgMuted hover:text-fg"}`}
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
          <Input placeholder="LOT-001 (optional)" value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-fgMuted">Location</label>
          <Input placeholder="default" value={location} onChange={(e) => setLocation(e.target.value)} />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-fgMuted">Note</label>
          <Input placeholder="PO#, WO# or description" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {mutation.isError && (
          <p className="text-sm text-danger">{String(mutation.error)}</p>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!qty || isNaN(parseFloat(qty)) || parseFloat(qty) <= 0 || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Posting…" : "Post Transaction"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create Inventory page**

Create `apps/web/app/(shell)/mfg/inventory/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal } from "lucide-react";
import { Button, Input, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { listInventory, type StockBalance } from "@/lib/api/inventory";
import { StockTransactionPanel } from "@/components/StockTransactionPanel";

export default function InventoryPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<StockBalance | null>(null);
  const [itemName, setItemName] = useState("");

  const { data: balances = [], isLoading, refetch } = useQuery({
    queryKey: ["inventory"],
    queryFn: listInventory,
  });

  const filtered = balances.filter((b) =>
    !search ||
    b.itemId.toLowerCase().includes(search.toLowerCase()) ||
    b.lotNumber.toLowerCase().includes(search.toLowerCase()) ||
    b.location.toLowerCase().includes(search.toLowerCase())
  );

  function openTransaction(b: StockBalance) {
    setSelected(b);
    setItemName(b.itemId); // ideally resolve to item name via items cache
  }

  return (
    <div className="flex flex-col h-full">
      <Breadcrumb items={[{ label: "Manufacturing Hub", href: "/mfg/home" }, { label: "Inventory" }]} />
      <CommandBar
        actions={[
          { label: "Receive", icon: ArrowDownToLine, onClick: () => {} },
          { label: "Issue",   icon: ArrowUpFromLine, onClick: () => {} },
          { label: "Refresh", icon: RefreshCw, onClick: () => refetch() },
        ]}
      />

      {/* Filter bar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <Input
          placeholder="Search item, lot, location…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <span className="ml-auto text-xs text-fgMuted">{filtered.length} records</span>
      </div>

      {/* Column headers */}
      <div className="flex border-b border-border bg-surface-2 px-4 py-1.5 text-xs font-medium text-fgMuted">
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
              <div key={i} className="h-10 animate-pulse border-b border-border bg-surface-2" />
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
              className="flex items-center border-b border-border px-4 py-2 text-sm hover:bg-surface-2"
            >
              <span className="flex-1 font-mono text-xs">{b.itemId.slice(0, 8)}…</span>
              <span className="w-32 text-xs text-fgMuted">{b.lotNumber || "—"}</span>
              <span className="w-32 text-xs text-fgMuted">{b.location}</span>
              <span className={`w-28 text-right font-mono text-sm font-semibold
                ${b.qtyOnHand < 0 ? "text-danger" : b.qtyOnHand === 0 ? "text-fgMuted" : "text-fg"}`}>
                {b.qtyOnHand.toFixed(3)}
              </span>
              <span className="w-24 text-right text-xs text-fgMuted">
                {new Date(b.updatedAt).toLocaleDateString()}
              </span>
              <div className="w-16 flex justify-end">
                <Button size="sm" variant="ghost" onClick={() => openTransaction(b)}>
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
```

- [ ] **Step 3: Add Inventory to MFG nav**

In `apps/web/src/lib/mock/apps.ts`, find the MFG hub and add to the appropriate group:

```typescript
{ id: "inventory", name: "Inventory", href: "/mfg/inventory", icon: "warehouse" },
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter web typecheck 2>&1 | grep "error TS" | head -20
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat(web): Inventory list page + StockTransactionPanel (Plan #11 Task E)"
```

---

### Task F — Final integration

- [ ] **Step 1: Start mfg-svc and test endpoints**

```bash
cd services/mfg-svc && go run ./cmd/server
```

In another terminal:
```bash
curl -s -H "X-Tenant-Id: <tenant-uuid>" http://localhost:8085/v1/inventory | jq
```

Expected: `{"items":[],"total":0}`

- [ ] **Step 2: Post a test transaction**

```bash
curl -s -X POST http://localhost:8085/v1/inventory/transactions \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: <tenant-uuid>" \
  -d '{"item_id":"<item-uuid>","txn_type":"receive","qty":100,"lot_number":"LOT-001","location":"WH-A","note":"Initial stock","created_by":"<user-uuid>"}' | jq
```

Expected: 201 with transaction object

- [ ] **Step 3: Verify stock balance updated**

```bash
curl -s -H "X-Tenant-Id: <tenant-uuid>" http://localhost:8085/v1/inventory | jq '.items[0].qty_on_hand'
```

Expected: `100`

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat(platform): Plan #11 complete — Inventory Management"
```
