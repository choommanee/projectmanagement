"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Input, Tag, Dialog } from "@pmplatform/ui-kit";
import {
  listAccounts, createAccount, updateAccount, deleteAccount,
  type ChartOfAccount, type AccountType,
} from "@/lib/api/accounting";

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "asset",     label: "Asset"     },
  { value: "liability", label: "Liability" },
  { value: "equity",    label: "Equity"    },
  { value: "revenue",   label: "Revenue"   },
  { value: "expense",   label: "Expense"   },
];

function typeTone(t: AccountType): "neutral" | "info" | "accent" | "success" | "warning" | "danger" {
  if (t === "asset")     return "success";
  if (t === "liability") return "danger";
  if (t === "equity")    return "info";
  if (t === "revenue")   return "accent";
  if (t === "expense")   return "warning";
  return "neutral";
}

type FormData = { code: string; name: string; type: AccountType; currency: string; active: boolean };
const EMPTY: FormData = { code: "", name: "", type: "asset", currency: "THB", active: true };

function AccountDialog({
  open, initial, onClose, onSaved,
}: {
  open: boolean;
  initial: ChartOfAccount | null;
  onClose: () => void;
  onSaved: (a: ChartOfAccount) => void;
}) {
  const [form, setForm] = useState<FormData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      setForm({ code: initial.code, name: initial.name, type: initial.type, currency: initial.currency, active: initial.active });
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
        ? await updateAccount(initial.id, { name: form.name, type: form.type, currency: form.currency, active: form.active })
        : await createAccount({ code: form.code, name: form.name, type: form.type, currency: form.currency, active: form.active });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save account");
    } finally {
      setLoading(false);
    }
  }

  const f = (k: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={initial ? "Edit Account" : "New Account"}
      description="Chart of accounts — code, name, type, and currency"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>
            {initial ? "Save changes" : "Create account"}
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
            <Input value={form.code} onChange={f("code")} placeholder="1000" required disabled={!!initial} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Name *</label>
            <Input value={form.name} onChange={f("name")} placeholder="Cash and Cash Equivalents" required />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm(p => ({ ...p, type: e.target.value as AccountType }))}
              className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
            >
              {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Currency</label>
            <Input value={form.currency} onChange={f("currency")} placeholder="THB" />
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

function DeleteDialog({ account, onClose, onDeleted }: { account: ChartOfAccount; onClose: () => void; onDeleted: () => void }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setErr(null);
    try {
      await deleteAccount(account.id);
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
        <h3 className="font-semibold text-ink">Delete Account</h3>
        <p className="mt-2 text-sm text-ink-2">
          Delete <span className="font-mono font-medium">{account.code}</span> — {account.name}? This cannot be undone.
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

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ChartOfAccount | null>(null);
  const [deleting, setDeleting] = useState<ChartOfAccount | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listAccounts();
      setAccounts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openNew() { setEditing(null); setDialogOpen(true); }
  function openEdit(a: ChartOfAccount) { setEditing(a); setDialogOpen(true); }

  function handleSaved(a: ChartOfAccount) {
    setDialogOpen(false);
    setAccounts(prev => {
      const idx = prev.findIndex(x => x.id === a.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = a; return n; }
      return [a, ...prev];
    });
  }

  function handleDeleted() {
    if (deleting) setAccounts(prev => prev.filter(x => x.id !== deleting.id));
    setDeleting(null);
  }

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Accounting Hub", href: "/accounting/home" }, { label: "General Ledger" }, { label: "Chart of Accounts" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New Account", variant: "primary", onClick: openNew },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
        )}
        {loading && !accounts.length ? (
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
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Currency</th>
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-b border-line hover:bg-surface-2">
                  <td className="px-4 py-2 font-mono text-xs uppercase text-ink">{a.code}</td>
                  <td className="px-4 py-2 font-medium text-ink">{a.name}</td>
                  <td className="px-4 py-2">
                    <Tag tone={typeTone(a.type)}>{a.type}</Tag>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-2">{a.currency}</td>
                  <td className="px-4 py-2 text-center">
                    <Tag tone={a.active ? "success" : "neutral"} dot>
                      {a.active ? "active" : "inactive"}
                    </Tag>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => openEdit(a)}
                        className="rounded-xs px-2 py-1 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleting(a)}
                        className="rounded-xs px-2 py-1 text-xs text-ink-2 hover:bg-danger/10 hover:text-danger"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && accounts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-3">
                    No accounts found. Create your first account to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <AccountDialog
        open={dialogOpen}
        initial={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={handleSaved}
      />

      {deleting && (
        <DeleteDialog
          account={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
