"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getDepartment, listEmployees, type Department, type Employee } from "@/lib/api/hr";

export default function DepartmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [dept, setDept] = useState<Department | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getDepartment(id),
      listEmployees({ dept_id: id }),
    ]).then(([d, empResult]) => {
      setDept(d);
      setEmployees(empResult.items);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!dept) return <div className="p-8 text-destructive">Department not found.</div>;

  const activeCount = employees.filter(e => e.status === "active").length;

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-muted-foreground">
        <button onClick={() => router.push("/hr/departments")} className="hover:underline">Departments</button>
        <span className="mx-2">/</span>
        <span>{dept.name}</span>
      </nav>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{dept.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">Code: {dept.code}</p>
          </div>
          <span className={`px-2 py-1 rounded text-xs font-medium ${dept.active ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'}`}>
            {dept.active ? "active" : "inactive"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Employees", value: String(employees.length) },
          { label: "Active Employees", value: String(activeCount) },
          { label: "Department Code", value: dept.code },
          { label: "Created", value: dept.createdAt ? dept.createdAt.slice(0, 10) : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-lg font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {employees.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
            Employees ({employees.length})
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground text-xs uppercase">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Position</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id} className="border-t border-border hover:bg-muted/30 cursor-pointer"
                  onClick={() => router.push('/hr/employees/' + emp.id)}>
                  <td className="py-2 pr-4 font-medium">{emp.firstName} {emp.lastName}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{emp.positionName ?? "—"}</td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${emp.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'}`}>
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
        <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No employees in this department.
        </div>
      )}
    </div>
  );
}
