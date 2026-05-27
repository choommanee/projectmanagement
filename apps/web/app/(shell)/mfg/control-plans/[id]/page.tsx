"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getControlPlan, listControlPlanChars, type ControlPlan, type ControlPlanChar } from "@/lib/api/quality";

export default function MfgControlPlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [cp, setCp] = useState<ControlPlan | null>(null);
  const [chars, setChars] = useState<ControlPlanChar[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([getControlPlan(id), listControlPlanChars(id)])
      .then(([c, ch]) => { setCp(c); setChars(ch); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-ink-3">Loading...</div>;
  if (!cp) return <div className="p-8 text-destructive">Control plan not found.</div>;

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-ink-3">
        <button onClick={() => router.push("/mfg/control-plans")} className="hover:underline">Control Plans</button>
        <span className="mx-2">/</span>
        <span>{cp.name}</span>
      </nav>

      <div className="rounded-lg border border-line bg-card p-6">
        <h1 className="text-2xl font-semibold">{cp.name}</h1>
        <p className="text-sm text-ink-3 mt-1">Status: {cp.status} · Version: {cp.version}</p>
        {cp.notes && <p className="mt-3 text-sm text-ink-3">{cp.notes}</p>}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Characteristics", value: String(chars.length) },
          { label: "Version", value: String(cp.version) },
          { label: "Status", value: cp.status },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-line bg-card p-4">
            <p className="text-xs text-ink-3 uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-lg font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {chars.length > 0 && (
        <div className="rounded-lg border border-line bg-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3 mb-4">
            Characteristics ({chars.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="text-left text-ink-3 text-xs uppercase">
                  <th className="py-2 pr-4">No</th>
                  <th className="py-2 pr-4">Characteristic</th>
                  <th className="py-2 pr-4">Spec</th>
                  <th className="py-2 pr-4">Sample Size</th>
                  <th className="py-2 pr-4">Frequency</th>
                  <th className="py-2">Measurement</th>
                </tr>
              </thead>
              <tbody>
                {chars.sort((a, b) => a.sortOrder - b.sortOrder).map(ch => (
                  <tr key={ch.id} className="border-t border-line">
                    <td className="py-2 pr-4 font-mono text-ink-3">{ch.no}</td>
                    <td className="py-2 pr-4 font-medium">{ch.characteristic}</td>
                    <td className="py-2 pr-4">{ch.spec}</td>
                    <td className="py-2 pr-4 text-center">{ch.sampleSize}</td>
                    <td className="py-2 pr-4">{ch.sampleFreq}</td>
                    <td className="py-2">{ch.measurementMethod}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
