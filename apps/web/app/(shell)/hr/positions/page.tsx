"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Input, Tag, Dialog } from "@pmplatform/ui-kit";
import {
  listPositions, createPosition, updatePosition, deletePosition,
  listDepartments,
  type Position, type Department,
} from "@/lib/api/hr";

type FormData = { code: string; name: string; department_id: string; active: boolean };
const EMPTY: FormData = { code: "", name: "", department_id: "", active: true };

function PositionDialog({
  open, initial, departments, onClose, onSaved,
}: {
  open: boolean;
  initial: Position | null;
  departments: Department[];
  onClose: () => void;
  onSaved: (p: Position) => void;
}) {
  const [form, setForm] = useState<FormData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      setForm({
        code: initial.code,
        name: initial.name,
        department_id: initial.departmentId ?? "",
        active: initial.active,
      });
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
        ? await updatePosition(initial.id, initial.version, {
            name: form.name,
            department_id: form.department_id || null,
            active: form.active,
          })
        : await createPosition({
            code: form.code,
            name: form.name,
            department_id: form.department_id || null,
            active: form.active,
          });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save position");
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
      title={initial ? "Edit Position" : "New Position"}
      description="Job position master data"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>
            {initial ? "Save changes" : "Create position"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Code *</label>
            <Input value={form.code} onChange={f("code")} placeholder="ENG-L1" required disabled={!!initial} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Name *</label>
            <Input value={form.name} onChange={f("name")} placeholder="Software Engineer L1" required />
          </div>
        </div>
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

function DeleteDialog({ position, onClose, onDeleted }: { position: Position; onClose: () => void; onDeleted: () => void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setErr(null);
    try {
      await deletePosition(position.id, position.version);
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
        <h3 className="font-semibold text-ink">Delete Position</h3>
        <p className="mt-2 text-sm text-ink-2">
          Delete <span className="font-mono font-medium">{position.code}</span> — {position.name}? This cannot be undone.
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

export default function PositionsPage() {
  const router = useRouter();
  const [positions, setPositions] = useState<Position[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);
  const [deleting, setDeleting] = useState<Position | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pos, depts] = await Promise.all([
        listPositions(),
        departments.length === 0 ? listDepartments() : Promise.resolve(departments),
      ]);
      setPositions(pos);
      if (departments.length === 0) setDepartments(depts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load positions");
    } finally {
      setLoading(false);
    }
  }, [departments]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openNew() { setEditing(null); setDialogOpen(true); }
  function openEdit(p: Position) { setEditing(p); setDialogOpen(true); }

  function handleSaved(p: Position) {
    setDialogOpen(false);
    setPositions(prev => {
      const idx = prev.findIndex(x => x.id === p.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = p; return n; }
      return [p, ...prev];
    });
  }

  function handleDeleted() {
    if (deleting) setPositions(prev => prev.filter(x => x.id !== deleting.id));
    setDeleting(null);
  }

  const deptMap = new Map(departments.map(d => [d.id, d]));

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "HR Hub", href: "/hr/home" }, { label: "Organization" }, { label: "Positions" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New Position", variant: "primary", onClick: openNew },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
        )}
        {loading && !positions.length ? (
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
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Department</th>
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2">Created</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const dept = p.departmentId ? deptMap.get(p.departmentId) : null;
                return (
                  <tr key={p.id} className="border-b border-line hover:bg-surface-2 cursor-pointer" onClick={() => router.push('/hr/positions/' + p.id)}>
                    <td className="px-4 py-2 font-mono text-xs uppercase text-ink">{p.code}</td>
                    <td className="px-4 py-2 font-medium text-ink">{p.name}</td>
                    <td className="px-4 py-2 text-xs text-ink-2">
                      {dept ? `${dept.code} — ${dept.name}` : (p.departmentName ?? "—")}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <Tag tone={p.active ? "success" : "neutral"} dot>
                        {p.active ? "active" : "inactive"}
                      </Tag>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-2">
                      {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => openEdit(p)}
                          className="rounded-xs px-2 py-1 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleting(p)}
                          className="rounded-xs px-2 py-1 text-xs text-ink-2 hover:bg-danger/10 hover:text-danger"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && positions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-3">
                    No positions found. Add your first position to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <PositionDialog
        open={dialogOpen}
        initial={editing}
        departments={departments}
        onClose={() => setDialogOpen(false)}
        onSaved={handleSaved}
      />

      {deleting && (
        <DeleteDialog
          position={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
