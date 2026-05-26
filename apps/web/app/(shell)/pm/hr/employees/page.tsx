"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Input, Tag, Dialog } from "@pmplatform/ui-kit";
import {
  listEmployees, createEmployee, updateEmployee, terminateEmployee,
  listDepartments, listPositions,
  type Employee, type EmpStatus, type Department, type Position,
} from "@/lib/api/hr";

const EMP_STATUSES: { value: EmpStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "on_leave", label: "On Leave" },
  { value: "terminated", label: "Terminated" },
];

function statusTone(s: EmpStatus): "neutral" | "info" | "accent" | "success" | "warning" | "danger" {
  if (s === "active")     return "success";
  if (s === "inactive")   return "neutral";
  if (s === "on_leave")   return "warning";
  if (s === "terminated") return "danger";
  return "neutral";
}

type FormData = {
  emp_no: string;
  first_name: string;
  last_name: string;
  email: string;
  department_id: string;
  position_id: string;
  hire_date: string;
};

const EMPTY: FormData = {
  emp_no: "", first_name: "", last_name: "", email: "",
  department_id: "", position_id: "",
  hire_date: new Date().toISOString().split("T")[0],
};

function EmployeeDialog({
  open, initial, departments, positions, onClose, onSaved,
}: {
  open: boolean;
  initial: Employee | null;
  departments: Department[];
  positions: Position[];
  onClose: () => void;
  onSaved: (e: Employee) => void;
}) {
  const [form, setForm] = useState<FormData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      setForm({
        emp_no: initial.empNo,
        first_name: initial.firstName,
        last_name: initial.lastName,
        email: initial.email,
        department_id: initial.departmentId ?? "",
        position_id: initial.positionId ?? "",
        hire_date: initial.hireDate ? initial.hireDate.split("T")[0] : "",
      });
    } else {
      setForm(EMPTY);
    }
    setError(null);
  }, [initial, open]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!form.emp_no || !form.first_name || !form.last_name) {
      setError("Employee number, first name, and last name are required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const saved = initial
        ? await updateEmployee(initial.id, {
            first_name: form.first_name,
            last_name: form.last_name,
            email: form.email,
            department_id: form.department_id || null,
            position_id: form.position_id || null,
          })
        : await createEmployee({
            emp_no: form.emp_no,
            first_name: form.first_name,
            last_name: form.last_name,
            email: form.email,
            department_id: form.department_id || null,
            position_id: form.position_id || null,
            hire_date: form.hire_date || undefined,
          });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save employee");
    } finally {
      setLoading(false);
    }
  }

  const f = (k: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? "Edit Employee" : "New Employee"}
      description="Employee master data"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>
            {initial ? "Save changes" : "Create employee"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Emp No *</label>
            <Input value={form.emp_no} onChange={f("emp_no")} placeholder="EMP-001" required disabled={!!initial} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">First Name *</label>
            <Input value={form.first_name} onChange={f("first_name")} placeholder="Somchai" required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Last Name *</label>
            <Input value={form.last_name} onChange={f("last_name")} placeholder="Jaidee" required />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">Email</label>
          <Input type="email" value={form.email} onChange={f("email")} placeholder="employee@company.com" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Department</label>
            <select
              value={form.department_id}
              onChange={(e) => setForm(p => ({ ...p, department_id: e.target.value }))}
              className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
            >
              <option value="">— none —</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Position</label>
            <select
              value={form.position_id}
              onChange={(e) => setForm(p => ({ ...p, position_id: e.target.value }))}
              className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
            >
              <option value="">— none —</option>
              {positions.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </div>
        </div>
        {!initial && (
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Hire Date</label>
            <Input type="date" value={form.hire_date} onChange={f("hire_date")} />
          </div>
        )}
      </form>
    </Dialog>
  );
}

function TerminateDialog({
  employee, onClose, onTerminated,
}: {
  employee: Employee;
  onClose: () => void;
  onTerminated: (e: Employee) => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    if (!date) { setErr("Termination date is required."); return; }
    setLoading(true);
    setErr(null);
    try {
      const updated = await terminateEmployee(employee.id, date);
      onTerminated(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to terminate employee");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-96 rounded-md border border-line bg-paper p-4 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-ink">Terminate Employee</h3>
        <p className="mt-2 text-sm text-ink-2">
          Terminate <span className="font-medium">{employee.firstName} {employee.lastName}</span> ({employee.empNo})?
        </p>
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-ink-2">Termination Date *</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none"
          />
        </div>
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => void go()}>Terminate</Button>
        </div>
      </div>
    </div>
  );
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [statusFilter, setStatusFilter] = useState<EmpStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [terminating, setTerminating] = useState<Employee | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, depts, pos] = await Promise.all([
        listEmployees({ status: statusFilter || undefined }),
        departments.length === 0 ? listDepartments() : Promise.resolve(departments),
        positions.length === 0 ? listPositions() : Promise.resolve(positions),
      ]);
      setEmployees(res.items);
      setTotal(res.total);
      if (departments.length === 0) setDepartments(depts);
      if (positions.length === 0) setPositions(pos);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load employees");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, departments, positions]);

  useEffect(() => { void load(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  function openNew() { setEditing(null); setDialogOpen(true); }
  function openEdit(e: Employee) { setEditing(e); setDialogOpen(true); }

  function handleSaved(e: Employee) {
    setDialogOpen(false);
    setEmployees(prev => {
      const idx = prev.findIndex(x => x.id === e.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = e; return n; }
      return [e, ...prev];
    });
  }

  function handleTerminated(e: Employee) {
    setTerminating(null);
    setEmployees(prev => {
      const idx = prev.findIndex(x => x.id === e.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = e; return n; }
      return prev;
    });
  }

  const deptMap = new Map(departments.map(d => [d.id, d]));
  const posMap = new Map(positions.map(p => [p.id, p]));

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "PM Hub", href: "/pm/home" }, { label: "HR" }, { label: "Employees" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New Employee", variant: "primary", onClick: openNew },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      {/* Status filter bar */}
      <div className="flex items-center gap-1 border-b border-line bg-paper px-4 py-2">
        {EMP_STATUSES.map(t => (
          <button
            key={t.value}
            onClick={() => setStatusFilter(t.value)}
            className={`rounded-xs px-3 py-1 text-xs font-medium transition-colors ${statusFilter === t.value ? "bg-accent text-white" : "text-ink-2 hover:bg-surface-2"}`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-ink-3">{total} employees</span>
      </div>

      {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && !employees.length ? (
          <div className="space-y-px">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-10 animate-pulse border-b border-line bg-surface-2" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Emp No</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Department</th>
                <th className="px-4 py-2">Position</th>
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2">Hire Date</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => {
                const dept = emp.departmentId ? deptMap.get(emp.departmentId) : null;
                const pos = emp.positionId ? posMap.get(emp.positionId) : null;
                return (
                  <tr key={emp.id} className="border-b border-line hover:bg-surface-2">
                    <td className="px-4 py-2 font-mono text-xs uppercase text-ink">{emp.empNo}</td>
                    <td className="px-4 py-2 font-medium text-ink">
                      {emp.firstName} {emp.lastName}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-2">{emp.email || "—"}</td>
                    <td className="px-4 py-2 text-xs text-ink-2">
                      {dept ? `${dept.code} — ${dept.name}` : (emp.departmentName ?? "—")}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-2">
                      {pos ? pos.name : (emp.positionName ?? "—")}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <Tag tone={statusTone(emp.status)} dot>{emp.status}</Tag>
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-2">
                      {emp.hireDate ? new Date(emp.hireDate).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(emp)}
                          className="rounded-xs px-2 py-1 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                        >
                          Edit
                        </button>
                        {emp.status !== "terminated" && (
                          <button
                            onClick={() => setTerminating(emp)}
                            className="rounded-xs px-2 py-1 text-xs text-ink-2 hover:bg-danger/10 hover:text-danger"
                          >
                            Terminate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && employees.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-ink-3">
                    No employees found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <EmployeeDialog
        open={dialogOpen}
        initial={editing}
        departments={departments}
        positions={positions}
        onClose={() => setDialogOpen(false)}
        onSaved={handleSaved}
      />

      {terminating && (
        <TerminateDialog
          employee={terminating}
          onClose={() => setTerminating(null)}
          onTerminated={handleTerminated}
        />
      )}
    </div>
  );
}
