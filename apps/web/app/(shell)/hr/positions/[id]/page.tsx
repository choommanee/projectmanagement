"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getPosition, listEmployees, type Position, type Employee } from "@/lib/api/hr";

export default function PositionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [pos, setPos] = useState<Position | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getPosition(id)
      .then(async p => {
        setPos(p);
        const empResult = await listEmployees();
        setEmployees(empResult.items.filter(e => e.positionId === id));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-ink-3">Loading...</div>;
  if (!pos) return <div className="p-8 text-destructive">Position not found.</div>;

  const activeCount = employees.filter(e => e.status === "active").length;

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-ink-3">
        <button onClick={() => router.push("/hr/positions")} className="hover:underline">Positions</button>
        <span className="mx-2">/</span>
        <span>{pos.name}</span>
      </nav>

      <div className="rounded-lg border border-line bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{pos.name}</h1>
            <p className="text-sm text-ink-3 mt-1">
              Code: {pos.code}
              {pos.departmentName ? ` · Department: ${pos.departmentName}` : ""}
            </p>
          </div>
          <span className={`px-2 py-1 rounded text-xs font-medium ${pos.active ? 'bg-green-100 text-green-800' : 'bg-muted text-ink-3'}`}>
            {pos.active ? "active" : "inactive"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Employees", value: String(employees.length) },
          { label: "Active Employees", value: String(activeCount) },
          { label: "Department", value: pos.departmentName ?? "—" },
          { label: "Created", value: pos.createdAt ? pos.createdAt.slice(0, 10) : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-line bg-card p-4">
            <p className="text-xs text-ink-3 uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-lg font-semibold font-mono">{value}</p>
          </div>
        ))}
      </div>

      {employees.length > 0 && (
        <div className="rounded-lg border border-line bg-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3 mb-4">
            Employees in this Position ({employees.length})
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-3 text-xs uppercase">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Department</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id} className="border-t border-line hover:bg-surface-2 cursor-pointer"
                  onClick={() => router.push('/hr/employees/' + emp.id)}>
                  <td className="py-2 pr-4 font-medium">{emp.firstName} {emp.lastName}</td>
                  <td className="py-2 pr-4 text-ink-3">{emp.departmentName ?? "—"}</td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${emp.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-muted text-ink-3'}`}>
                      {emp.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {employees.length === 0 && !loading && (
        <div className="rounded-lg border border-line bg-card p-6 text-center text-sm text-ink-3">
          No employees in this position.
        </div>
      )}
    </div>
  );
}
