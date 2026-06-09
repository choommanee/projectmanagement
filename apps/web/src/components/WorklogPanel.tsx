"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Clock, Pencil, Trash2, Check, X } from "lucide-react";
import { Button, Input } from "@pmplatform/ui-kit";
import {
  listWorklogs,
  createWorklog,
  updateWorklog,
  deleteWorklog,
  type WorklogEntry,
} from "@/lib/api/worklog";
import { useAuth } from "@/lib/auth/AuthProvider";

interface Props {
  taskId: string;
  estimateMd: number;
  actualMd: number;
}

export function WorklogPanel({ taskId, estimateMd }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [loggedMd, setLoggedMd] = useState("");
  const [note, setNote] = useState("");
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));
  const [editId, setEditId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["worklogs", taskId],
    queryFn: () => listWorklogs(taskId),
  });

  const createMut = useMutation({
    mutationFn: () =>
      createWorklog(taskId, {
        userId:   user?.id ?? "",
        loggedMd: parseFloat(loggedMd),
        workDate,
        note,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["worklogs", taskId] });
      setLoggedMd("");
      setNote("");
    },
  });

  const totalLogged = entries.reduce((s, e) => s + e.loggedMd, 0);
  const remaining = Math.max(0, estimateMd - totalLogged);

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Estimate",  value: `${estimateMd}d` },
          { label: "Logged",    value: `${totalLogged.toFixed(1)}d` },
          { label: "Remaining", value: `${remaining.toFixed(1)}d` },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-md border border-line bg-paper px-3 py-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-ink-3">{label}</p>
            <p className="font-mono text-sm font-semibold text-ink">{value}</p>
          </div>
        ))}
      </div>

      {/* Log form */}
      <div className="rounded-md border border-line bg-surface p-3 shadow-xs space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">Log Time</p>
        <div className="flex gap-2">
          <Input
            placeholder="Days (e.g. 0.5)"
            value={loggedMd}
            onChange={(e) => setLoggedMd(e.target.value)}
            className="w-28 font-mono text-[12px]"
          />
          <Input
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
            className="w-36"
          />
          <Input
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="flex-1"
          />
          <Button
            size="sm"
            variant="primary"
            aria-label="Log time"
            disabled={!loggedMd || isNaN(parseFloat(loggedMd)) || parseFloat(loggedMd) <= 0 || createMut.isPending}
            loading={createMut.isPending}
            onClick={() => createMut.mutate()}
          >
            <Plus size={14} />
            Log
          </Button>
        </div>
        {createMut.isError && (
          <p className="text-xs text-danger">{(createMut.error as Error)?.message ?? String(createMut.error)}</p>
        )}
      </div>

      {rowError && <p className="text-xs text-danger">{rowError}</p>}

      {/* Log history */}
      {isLoading ? (
        <div className="space-y-2 animate-pulse">
          {[1, 2].map((i) => (
            <div key={i} className="h-10 rounded-sm bg-surface-2" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-ink-3">
          <Clock size={28} strokeWidth={1.5} />
          <p className="text-sm">No time logged yet</p>
        </div>
      ) : (
        <div className="divide-y divide-line rounded-md border border-line">
          {entries.map((e) =>
            editId === e.id ? (
              <WorklogEditRow
                key={e.id}
                entry={e}
                onCancel={() => { setEditId(null); setRowError(null); }}
                onSaved={() => {
                  setEditId(null);
                  setRowError(null);
                  void qc.invalidateQueries({ queryKey: ["worklogs", taskId] });
                }}
                onError={setRowError}
              />
            ) : (
              <div key={e.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-ink">{e.loggedMd}d</span>
                  {e.note && <span className="truncate text-xs text-ink-2">{e.note}</span>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[11px] text-ink-3">{e.workDate.slice(0, 10)}</span>
                  <button
                    type="button"
                    aria-label="Edit worklog"
                    onClick={() => { setEditId(e.id); setRowError(null); }}
                    className="rounded-sm p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
                  >
                    <Pencil size={13} />
                  </button>
                  <WorklogDeleteButton
                    entry={e}
                    onDeleted={() => void qc.invalidateQueries({ queryKey: ["worklogs", taskId] })}
                    onError={setRowError}
                  />
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function WorklogEditRow({
  entry,
  onCancel,
  onSaved,
  onError,
}: {
  entry: WorklogEntry;
  onCancel(): void;
  onSaved(): void;
  onError(msg: string): void;
}) {
  const [loggedMd, setLoggedMd] = useState(String(entry.loggedMd));
  const [workDate, setWorkDate] = useState(entry.workDate.slice(0, 10));
  const [note, setNote] = useState(entry.note);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await updateWorklog(entry.id, {
        loggedMd: parseFloat(loggedMd),
        workDate,
        note,
        version: entry.version,
      });
      onSaved();
    } catch (e) {
      const msg = (e as Error).message;
      onError(msg.includes("409") || msg.toLowerCase().includes("conflict")
        ? "This worklog changed elsewhere — reopen to edit."
        : msg);
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <Input value={loggedMd} onChange={(e) => setLoggedMd(e.target.value)} className="w-20 font-mono text-[12px]" aria-label="Logged days" />
      <Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className="w-36" aria-label="Work date" />
      <Input value={note} onChange={(e) => setNote(e.target.value)} className="flex-1" placeholder="Note" aria-label="Note" />
      <button
        type="button"
        aria-label="Save worklog"
        disabled={busy || !loggedMd || isNaN(parseFloat(loggedMd)) || parseFloat(loggedMd) <= 0}
        onClick={() => void save()}
        className="rounded-sm p-1 text-success hover:bg-success/10 disabled:opacity-40"
      >
        <Check size={14} />
      </button>
      <button type="button" aria-label="Cancel edit" onClick={onCancel} className="rounded-sm p-1 text-ink-3 hover:bg-surface-2 hover:text-ink">
        <X size={14} />
      </button>
    </div>
  );
}

function WorklogDeleteButton({
  entry,
  onDeleted,
  onError,
}: {
  entry: WorklogEntry;
  onDeleted(): void;
  onError(msg: string): void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function del() {
    setBusy(true);
    try {
      await deleteWorklog(entry.id, entry.version);
      onDeleted();
    } catch (e) {
      const msg = (e as Error).message;
      onError(msg.includes("409") || msg.toLowerCase().includes("conflict")
        ? "This worklog changed elsewhere — refresh and retry."
        : msg);
      setBusy(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-1">
        <button type="button" disabled={busy} onClick={() => void del()} className="rounded-sm px-1.5 py-0.5 text-[11px] font-semibold text-danger hover:bg-danger/10 disabled:opacity-40">
          Delete
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="rounded-sm px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-surface-2">
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      aria-label="Delete worklog"
      onClick={() => setConfirming(true)}
      className="rounded-sm p-1 text-ink-3 hover:bg-danger/10 hover:text-danger"
    >
      <Trash2 size={13} />
    </button>
  );
}
