"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Input, Tag, Dialog } from "@pmplatform/ui-kit";
import {
  listSuppliers, createSupplier, updateSupplier, deleteSupplier,
  type Supplier,
} from "@/lib/api/mfg";

type SupplierFormData = {
  code: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  lead_time_days: string;
  active: boolean;
};

const EMPTY_FORM: SupplierFormData = {
  code: "", name: "", contact: "", email: "", phone: "", lead_time_days: "0", active: true,
};

function SupplierDialog({
  open, initial, onClose, onSaved,
}: {
  open: boolean;
  initial: Supplier | null;
  onClose: () => void;
  onSaved: (s: Supplier) => void;
}) {
  const [form, setForm] = useState<SupplierFormData>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      setForm({
        code: initial.code,
        name: initial.name,
        contact: initial.contact,
        email: initial.email,
        phone: initial.phone,
        lead_time_days: String(initial.leadTimeDays),
        active: initial.active,
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setError(null);
  }, [initial, open]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!form.code || !form.name) { setError("Code and Name are required."); return; }
    setLoading(true);
    setError(null);
    try {
      const payload = {
        code: form.code,
        name: form.name,
        contact: form.contact,
        email: form.email,
        phone: form.phone,
        lead_time_days: Number(form.lead_time_days) || 0,
        active: form.active,
      };
      const saved = initial
        ? await updateSupplier(initial.id, payload)
        : await createSupplier(payload);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save supplier");
    } finally {
      setLoading(false);
    }
  }

  const f = (k: keyof SupplierFormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? "Edit Supplier" : "New Supplier"}
      description="Supplier master data — contact, lead times, and status"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>
            {initial ? "Save changes" : "Create supplier"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Code *</label>
            <Input value={form.code} onChange={f("code")} placeholder="SUP-001" required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Name *</label>
            <Input value={form.name} onChange={f("name")} placeholder="Supplier name" required />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Contact Person</label>
            <Input value={form.contact} onChange={f("contact")} placeholder="Jane Smith" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Email</label>
            <Input type="email" value={form.email} onChange={f("email")} placeholder="supplier@example.com" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Phone</label>
            <Input value={form.phone} onChange={f("phone")} placeholder="+66-2-XXX-XXXX" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Lead Time (days)</label>
            <Input type="number" min="0" value={form.lead_time_days} onChange={f("lead_time_days")} placeholder="14" />
          </div>
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

function DeleteDialog({ supplier, onClose, onDeleted }: { supplier: Supplier; onClose: () => void; onDeleted: () => void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setErr(null);
    try {
      await deleteSupplier(supplier.id);
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
        <h3 className="font-semibold text-ink">Delete Supplier</h3>
        <p className="mt-2 text-sm text-ink-2">
          Delete <span className="font-mono font-medium">{supplier.code}</span> — {supplier.name}? This cannot be undone.
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

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listSuppliers();
      setSuppliers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openNew() { setEditing(null); setDialogOpen(true); }
  function openEdit(s: Supplier) { setEditing(s); setDialogOpen(true); }

  function handleSaved(s: Supplier) {
    setDialogOpen(false);
    setSuppliers(prev => {
      const idx = prev.findIndex(x => x.id === s.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = s; return n; }
      return [s, ...prev];
    });
  }

  function handleDeleted() {
    if (deleting) setSuppliers(prev => prev.filter(x => x.id !== deleting.id));
    setDeleting(null);
  }

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Suppliers" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New Supplier", variant: "primary", onClick: openNew },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
        )}
        {loading && !suppliers.length ? (
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
                <th className="px-4 py-2">Contact</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2 text-right">Lead Time</th>
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id} className="border-b border-line hover:bg-surface-2">
                  <td className="px-4 py-2 font-mono text-xs uppercase text-ink">{s.code}</td>
                  <td className="px-4 py-2 font-medium text-ink">{s.name}</td>
                  <td className="px-4 py-2 text-xs text-ink-2">{s.contact || "—"}</td>
                  <td className="px-4 py-2 text-xs text-ink-2">{s.email || "—"}</td>
                  <td className="px-4 py-2 text-xs text-ink-2">{s.phone || "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-ink">{s.leadTimeDays} d</td>
                  <td className="px-4 py-2 text-center">
                    <Tag tone={s.active ? "success" : "neutral"} dot>
                      {s.active ? "active" : "inactive"}
                    </Tag>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => openEdit(s)}
                        className="rounded-xs px-2 py-1 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleting(s)}
                        className="rounded-xs px-2 py-1 text-xs text-ink-2 hover:bg-danger/10 hover:text-danger"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && suppliers.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-ink-3">
                    No suppliers found. Add your first supplier to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <SupplierDialog
        open={dialogOpen}
        initial={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={handleSaved}
      />

      {deleting && (
        <DeleteDialog
          supplier={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
