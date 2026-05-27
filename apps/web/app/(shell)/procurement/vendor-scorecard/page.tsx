"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Tag } from "@pmplatform/ui-kit";
import {
  listSuppliers,
  listPurchaseOrders,
  type Supplier,
  type PurchaseOrder,
} from "@/lib/api/mfg";

interface SupplierScore {
  supplier: Supplier;
  totalPOs: number;
  receivedPOs: number;
  onTimeRate: number;
  totalValue: number;
  score: "A" | "B" | "C" | "D";
}

function grade(rate: number): "A" | "B" | "C" | "D" {
  if (rate >= 0.9) return "A";
  if (rate >= 0.75) return "B";
  if (rate >= 0.6) return "C";
  return "D";
}

function gradeTone(g: string): "success" | "info" | "warning" | "danger" {
  if (g === "A") return "success";
  if (g === "B") return "info";
  if (g === "C") return "warning";
  return "danger";
}

function poPOValue(po: PurchaseOrder): number {
  return po.lines.reduce((s, l) => s + l.unitPrice * l.qtyOrdered, 0);
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0 }).format(n);
}

export default function VendorScorecardPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pos, setPOs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"score" | "totalPOs" | "totalValue">("score");

  useEffect(() => {
    Promise.allSettled([listSuppliers(), listPurchaseOrders()])
      .then(([sr, pr]) => {
        setSuppliers(sr.status === "fulfilled" ? sr.value : []);
        setPOs(pr.status === "fulfilled" ? pr.value.items : []);
      })
      .finally(() => setLoading(false));
  }, []);

  const scores = useMemo((): SupplierScore[] => {
    return suppliers
      .map((sup) => {
        const supPOs = pos.filter((p) => p.supplierId === sup.id);
        const received = supPOs.filter((p) => p.status === "received");
        const totalValue = supPOs.reduce((s, p) => s + poPOValue(p), 0);
        const onTimeRate = supPOs.length > 0 ? received.length / supPOs.length : 0;
        return {
          supplier: sup,
          totalPOs: supPOs.length,
          receivedPOs: received.length,
          onTimeRate,
          totalValue,
          score: grade(onTimeRate),
        };
      })
      .filter((s) => s.totalPOs > 0);
  }, [suppliers, pos]);

  const sorted = useMemo(() => {
    return [...scores].sort((a, b) => {
      if (sortBy === "totalPOs") return b.totalPOs - a.totalPOs;
      if (sortBy === "totalValue") return b.totalValue - a.totalValue;
      const gradeOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
      return (gradeOrder[a.score] ?? 4) - (gradeOrder[b.score] ?? 4);
    });
  }, [scores, sortBy]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb
        items={[{ label: "Procurement", href: "/procurement/home" }, { label: "Vendor Scorecard" }]}
      />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Vendor Scorecard</h1>
        <div className="flex items-center gap-2 text-sm text-ink-3">
          <span>Sort by:</span>
          {(["score", "totalPOs", "totalValue"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                sortBy === s ? "bg-accent text-white" : "bg-surface-2 hover:bg-surface-2"
              }`}
            >
              {s === "score" ? "Grade" : s === "totalPOs" ? "# POs" : "Value"}
            </button>
          ))}
        </div>
      </div>

      {/* Grade legend */}
      <div className="flex gap-3 text-xs text-ink-3">
        {[
          { g: "A", desc: "≥ 90% on-time" },
          { g: "B", desc: "75–89%" },
          { g: "C", desc: "60–74%" },
          { g: "D", desc: "< 60%" },
        ].map(({ g, desc }) => (
          <div key={g} className="flex items-center gap-1.5">
            <Tag tone={gradeTone(g)} size="sm">
              {g}
            </Tag>
            <span>{desc}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-ink-3">No supplier data with purchase orders.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-3">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Supplier</th>
                <th className="px-4 py-2 text-right font-medium">Total POs</th>
                <th className="px-4 py-2 text-right font-medium">Received</th>
                <th className="px-4 py-2 text-right font-medium">On-Time Rate</th>
                <th className="px-4 py-2 text-right font-medium">Total Value</th>
                <th className="px-4 py-2 text-center font-medium">Grade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sorted.map(({ supplier, totalPOs, receivedPOs, onTimeRate, totalValue, score }) => (
                <tr key={supplier.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2 font-medium">{supplier.name}</td>
                  <td className="px-4 py-2 text-right font-mono">{totalPOs}</td>
                  <td className="px-4 py-2 text-right font-mono">{receivedPOs}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 h-1.5 rounded-full bg-surface-2">
                        <div
                          className={`h-1.5 rounded-full ${
                            onTimeRate >= 0.9
                              ? "bg-success"
                              : onTimeRate >= 0.75
                              ? "bg-info"
                              : onTimeRate >= 0.6
                              ? "bg-warning"
                              : "bg-danger"
                          }`}
                          style={{ width: pct(onTimeRate) }}
                        />
                      </div>
                      <span className="font-mono text-xs w-10 text-right">{pct(onTimeRate)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(totalValue)}</td>
                  <td className="px-4 py-2 text-center">
                    <Tag tone={gradeTone(score)} size="sm">
                      {score}
                    </Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
