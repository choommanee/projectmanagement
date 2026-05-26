"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listNCRs, listApqp, listPpap, listInspections } from "@/lib/api/quality";

interface KpiTileProps {
  label: string;
  value: number | string;
  sub?: string;
}

function KpiTile({ label, value, sub }: KpiTileProps) {
  return (
    <div className="border border-line bg-surface p-4">
      <div className="text-xs font-medium uppercase tracking-widest text-ink-3">{label}</div>
      <div className="mt-2 font-mono text-3xl font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

export default function QualityHomePage() {
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  const [openNcrCount, setOpenNcrCount]   = useState<number | null>(null);
  const [apqpCount,    setApqpCount]      = useState<number | null>(null);
  const [ppapCount,    setPpapCount]      = useState<number | null>(null);
  const [pendingInsp,  setPendingInsp]    = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [ncrs, apqp, ppap, insp] = await Promise.allSettled([
        listNCRs({ status: "open" }),
        listApqp(),
        listPpap(),
        listInspections({ result: "hold" }),
      ]);

      setOpenNcrCount(ncrs.status  === "fulfilled" ? ncrs.value.length  : 0);
      setApqpCount   (apqp.status  === "fulfilled" ? apqp.value.length  : 0);
      setPpapCount   (ppap.status  === "fulfilled" ? ppap.value.length  : 0);
      setPendingInsp (insp.status  === "fulfilled" ? insp.value.length  : 0);
    } catch {
      // Non-critical — tiles show 0 gracefully
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Quality Hub", href: "/quality/home" }, { label: "Dashboard" }]} />

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="text-base font-semibold text-ink">Quality Dashboard</h1>
          <span className="font-mono text-xs text-ink-3">{today}</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <KpiTile
            label="Open NCRs"
            value={openNcrCount ?? "—"}
            sub="Nonconformances requiring action"
          />
          <KpiTile
            label="APQP Projects"
            value={apqpCount ?? "—"}
            sub="Active quality planning projects"
          />
          <KpiTile
            label="PPAP Packages"
            value={ppapCount ?? "—"}
            sub="Part submission packages total"
          />
          <KpiTile
            label="Inspections on Hold"
            value={pendingInsp ?? "—"}
            sub="Inspections with hold result"
          />
        </div>
      </div>
    </div>
  );
}
