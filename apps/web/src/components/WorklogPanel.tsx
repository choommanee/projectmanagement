"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Clock } from "lucide-react";
import { Button, Input } from "@pmplatform/ui-kit";
import { listWorklogs, createWorklog } from "@/lib/api/worklog";
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

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["worklogs", taskId],
    queryFn: () => listWorklogs(taskId),
  });

  const mutation = useMutation({
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
            disabled={!loggedMd || isNaN(parseFloat(loggedMd)) || parseFloat(loggedMd) <= 0 || mutation.isPending}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            <Plus size={14} />
            Log
          </Button>
        </div>
        {mutation.isError && (
          <p className="text-xs text-danger">{(mutation.error as Error)?.message ?? String(mutation.error)}</p>
        )}
      </div>

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
          {entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-ink">{e.loggedMd}d</span>
                {e.note && <span className="text-xs text-ink-2">{e.note}</span>}
              </div>
              <span className="font-mono text-[11px] text-ink-3">{e.workDate.slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
