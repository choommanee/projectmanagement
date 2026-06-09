"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Input, Tag, Dialog } from "@pmplatform/ui-kit";
import {
  listCustomers, createCustomer, updateCustomer, deleteCustomer,
  type Customer,
} from "@/lib/api/sales";

type CustomerFormData = {
  code: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  billing_address: string;
  active: boolean;
};

const EMPTY_FORM: CustomerFormData = {
  code: "", name: "", contact: "", email: "", phone: "", billing_address: "", active: true,
};

function CustomerDialog({
  open, initial, onClose, onSaved,
}: {
  open: boolean;
  initial: Customer | null;
  onClose: () => void;
  onSaved: (c: Customer) => void;
}) {
  const [form, setForm] = useState<CustomerFormData>(EMPTY_FORM);
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
        billing_address: initial.billingAddress,
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
      const saved = initial
        ? await updateCustomer(initial.id, {
            name: form.name,
            contact: form.contact,
            email: form.email,
            phone: form.phone,
            billing_address: form.billing_address,
            active: form.active,
            version: initial.version,
          })
        : await createCustomer({
            code: form.code,
            name: form.name,
            contact: form.contact,
            email: form.email,
            phone: form.phone,
            billing_address: form.billing_address,
            active: form.active,
          });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save customer");
    } finally {
      setLoading(false);
    }
  }

  const f = (k: keyof CustomerFormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? "Edit Customer" : "New Customer"}
      description="Customer master data — contact and billing information"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>
            {initial ? "Save changes" : "Create customer"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && (
          <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Code *</label>
            <Input value={form.code} onChange={f("code")} placeholder="CUST-001" required disabled={!!initial} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Name *</label>
            <Input value={form.name} onChange={f("name")} placeholder="Customer name" required />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Contact Person</label>
            <Input value={form.contact} onChange={f("contact")} placeholder="John Doe" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Email</label>
            <Input type="email" value={form.email} onChange={f("email")} placeholder="customer@example.com" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Phone</label>
            <Input value={form.phone} onChange={f("phone")} placeholder="+66-2-XXX-XXXX" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Active</label>
            <label className="mt-2 flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm(p => ({ ...p, active: e.target.checked }))}
                className="h-4 w-4 rounded border-line"
              />
              Active
            </label>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">Billing Address</label>
          <Input value={form.billing_address} onChange={f("billing_address")} placeholder="123 Street, City, Country" />
        </div>
      </form>
    </Dialog>
  );
}

function DeleteDialog({ customer, onClose, onDeleted }: { customer: Customer; onClose: () => void; onDeleted: () => void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setErr(null);
    try {
      await deleteCustomer(customer.id, customer.version);
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
        <h3 className="font-semibold text-ink">Delete Customer</h3>
        <p className="mt-2 text-sm text-ink-2">
          Delete <span className="font-mono font-medium">{customer.code}</span> — {customer.name}? This cannot be undone.
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

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listCustomers();
      setCustomers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load customers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSaved(c: Customer) {
    setDialogOpen(false);
    setCustomers(prev => {
      const idx = prev.findIndex(x => x.id === c.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = c; return n; }
      return [c, ...prev];
    });
  }

  function handleDeleted() {
    if (deleting) setCustomers(prev => prev.filter(x => x.id !== deleting.id));
    setDeleting(null);
  }

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Sales Hub", href: "/sales/home" }, { label: "Customers" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New Customer", variant: "primary", onClick: () => { setEditing(null); setDialogOpen(true); } },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
        )}
        {loading && !customers.length ? (
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
                <th className="px-4 py-2">Billing Address</th>
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b border-line hover:bg-surface-2 cursor-pointer" onClick={() => router.push('/sales/customers/' + c.id)}>
                  <td className="px-4 py-2 font-mono text-xs uppercase text-ink">{c.code}</td>
                  <td className="px-4 py-2 font-medium text-ink">{c.name}</td>
                  <td className="px-4 py-2 text-xs text-ink-2">{c.contact || "—"}</td>
                  <td className="px-4 py-2 text-xs text-ink-2">{c.email || "—"}</td>
                  <td className="px-4 py-2 text-xs text-ink-2">{c.phone || "—"}</td>
                  <td className="px-4 py-2 max-w-48 truncate text-xs text-ink-2">{c.billingAddress || "—"}</td>
                  <td className="px-4 py-2 text-center">
                    <Tag tone={c.active ? "success" : "neutral"} dot>
                      {c.active ? "active" : "inactive"}
                    </Tag>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => { setEditing(c); setDialogOpen(true); }}
                        className="rounded-xs px-2 py-1 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleting(c)}
                        className="rounded-xs px-2 py-1 text-xs text-ink-2 hover:bg-danger/10 hover:text-danger"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && customers.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-ink-3">
                    No customers found. Add your first customer to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <CustomerDialog
        open={dialogOpen}
        initial={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={handleSaved}
      />

      {deleting && (
        <DeleteDialog
          customer={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
