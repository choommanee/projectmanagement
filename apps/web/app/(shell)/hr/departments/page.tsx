"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Input, Tag, Dialog } from "@pmplatform/ui-kit";
import {
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  type Department,
} from "@/lib/api/hr";

type FormData = { code: string; name: string; parent_id: string; active: boolean };
const EMPTY: FormData = { code: "", name: "", parent_id: "", active: true };

function DeptDialog({
  open, initial, allDepts, onClose, onSaved,
}: {
  open: boolean;
  initial: Department | null;
  allDepts: Department[];
  onClose: () => void;
  onSaved: (d: Department) => void;
}) {
  const [form, setForm] = useState<FormData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      setForm({ code: initial.code, name: initial.name, parent_id: initial.parentId ?? "", active: initial.active });
    } else {
      setForm(EMPTY);
    }
    setError(null);
  }, [initial, open]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!form.code || !form.name) { setError("Code and Name are required."); return; }
    setLoading(true);
    setError(null);
    try {
      const saved = initial
        ? await updateDepartment(initial.id, { name: form.name, parent_id: form.parent_id || null, active: form.active })
        : await createDepartment({ code: form.code, name: form.name, parent_id: form.parent_id || null, active: form.active });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save department");
    } finally {
      setLoading(false);
    }
  }

  const f = (k: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const parentOptions = allDepts.filter(d => d.id !== initial?.id);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? "Edit Department" : "New Department"}
      description="Department master data"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>
            {initial ? "Save changes" : "Create department"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Code *</label>
            <Input value={form.code} onChange={f("code")} placeholder="ENG" required disabled={!!initial} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Name *</label>
            <Input value={form.name} onChange={f("name")} placeholder="Engineering" required />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">Parent Department</label>
          <select
            value={form.parent_id}
            onChange={(e) => setForm(p => ({ ...p, parent_id: e.target.value }))}
            className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
          >
            <option value="">— none (top-level) —</option>
            {parentOptions.map(d => <option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm(p => ({ ...p, active: e.target.checked }))}
            className="h-4 w-4 rounded border-line"
          />
          Active
        </label>
      </form>
    </Dialog>
  );
}

function DeleteDialog({ dept, onClose, onDeleted }: { dept: Department; onClose: () => void; onDeleted: () => void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setErr(null);
    try {
      await deleteDepartment(dept.id);
      onDeleted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-96 rounded-md border border-line bg-paper p-4 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-ink">Delete Department</h3>
        <p className="mt-2 text-sm text-ink-2">
          Delete <span className="font-mono font-medium">{dept.code}</span> — {dept.name}? This cannot be undone.
        </p>
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => void go()}>Delete</Button>
        </div>
      </div>
    </div>
  );
}

export default function DepartmentsPage() {
  const [depts, setDepts] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState<Department | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listDepartments();
      setDepts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load departments");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openNew() { setEditing(null); setDialogOpen(true); }
  function openEdit(d: Department) { setEditing(d); setDialogOpen(true); }

  function handleSaved(d: Department) {
    setDialogOpen(false);
    setDepts(prev => {
      const idx = prev.findIndex(x => x.id === d.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = d; return n; }
      return [d, ...prev];
    });
  }

  function handleDeleted() {
    if (deleting) setDepts(prev => prev.filter(x => x.id !== deleting.id));
    setDeleting(null);
  }

  const deptMap = new Map(depts.map(d => [d.id, d]));

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "HR Hub", href: "/hr/home" }, { label: "Organization" }, { label: "Departments" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New Department", variant: "primary", onClick: openNew },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
        )}
        {loading && !depts.length ? (
          <div className="space-y-px">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-10 animate-pulse border-b border-line bg-surface-2" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Parent Dept</th>
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {depts.map((d) => {
                const parent = d.parentId ? deptMap.get(d.parentId) : null;
                return (
                  <tr key={d.id} className="border-b border-line hover:bg-surface-2">
                    <td className="px-4 py-2 font-mono text-xs uppercase text-ink">{d.code}</td>
                    <td className="px-4 py-2 font-medium text-ink">{d.name}</td>
                    <td className="px-4 py-2 text-xs text-ink-2">
                      {parent ? `${parent.code} — ${parent.name}` : (d.parentName ?? "—")}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <Tag tone={d.active ? "success" : "neutral"} dot>
                        {d.active ? "active" : "inactive"}
                      </Tag>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(d)}
                          className="rounded-xs px-2 py-1 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleting(d)}
                          className="rounded-xs px-2 py-1 text-xs text-ink-2 hover:bg-danger/10 hover:text-danger"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && depts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-3">
                    No departments found. Add your first department to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <DeptDialog
        open={dialogOpen}
        initial={editing}
        allDepts={depts}
        onClose={() => setDialogOpen(false)}
        onSaved={handleSaved}
      />

      {deleting && (
        <DeleteDialog
          dept={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
