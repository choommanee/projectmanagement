"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppNotification } from "@/lib/api/notifications";
import { listNotifications, markRead, markAllRead } from "@/lib/api/notifications";
import { CheckCheck } from "lucide-react";

// ── Notification kinds tracked for channel preferences ─────────────────────
interface KindPref {
  id: string;
  label: string;
  inApp: boolean;
  email: boolean;
}

const DEFAULT_PREFS: KindPref[] = [
  { id: "task.assigned",    label: "Task assigned",          inApp: true,  email: true  },
  { id: "comment.added",    label: "Comment added",          inApp: true,  email: false },
  { id: "sprint.started",   label: "Sprint started",         inApp: true,  email: true  },
  { id: "sprint.completed", label: "Sprint completed",       inApp: true,  email: false },
  { id: "wo.status",        label: "Work order status",      inApp: true,  email: false },
  { id: "mention",          label: "Mention (@)",            inApp: true,  email: true  },
  { id: "leave.approved",   label: "Leave request approved", inApp: true,  email: true  },
  { id: "leave.rejected",   label: "Leave request rejected", inApp: true,  email: true  },
];

const PREF_STORAGE_KEY = "notif_channel_prefs_v1";

function loadPrefs(): KindPref[] {
  if (typeof localStorage === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREF_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    return JSON.parse(raw) as KindPref[];
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(prefs: KindPref[]) {
  localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(prefs));
}

function fmtTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
  } catch {
    return iso;
  }
}

// ── Toggle switch primitive ──────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border transition-colors focus:outline-none focus:ring-1 focus:ring-accent ${
        checked ? "bg-accent border-accent" : "bg-surface border-line"
      }`}
    >
      <span
        className={`inline-block h-3 w-3 mt-0.5 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-3.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function NotificationPrefsPage() {
  // ── Notification history state ──────────────────────────────────────────
  const [items, setItems] = useState<AppNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [histError, setHistError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  // ── Channel prefs state ─────────────────────────────────────────────────
  const [prefs, setPrefs] = useState<KindPref[]>(DEFAULT_PREFS);
  const [prefSaved, setPrefSaved] = useState(false);

  // Hydrate prefs from localStorage after mount (client-only)
  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setHistError(null);
    try {
      const res = await listNotifications({ limit: 50 });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      setHistError(err instanceof Error ? err.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  async function handleMarkRead(id: string) {
    try {
      await markRead(id);
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n))
      );
    } catch {
      // non-fatal
    }
  }

  async function handleMarkAllRead() {
    setMarkingAll(true);
    try {
      await markAllRead();
      const now = new Date().toISOString();
      setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
    } catch {
      // non-fatal
    } finally {
      setMarkingAll(false);
    }
  }

  function togglePref(id: string, channel: "inApp" | "email") {
    setPrefs((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [channel]: !p[channel] } : p))
    );
    setPrefSaved(false);
  }

  function handleSavePrefs() {
    savePrefs(prefs);
    setPrefSaved(true);
    setTimeout(() => setPrefSaved(false), 3000);
  }

  const unread = items.filter((n) => !n.readAt).length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="font-mono text-[13px] font-semibold uppercase tracking-widest text-ink">
            Notification Preferences
          </h1>
          <p className="mt-1 font-mono text-[11px] text-ink-3">
            Recent activity and per-channel delivery settings.
          </p>
        </div>
      </div>

      {/* ── Section 1: Notification History ─────────────────────────────── */}
      <section className="rounded-sm border border-line bg-paper">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
              Recent Notifications
            </span>
            {!loading && (
              <span className="font-mono text-[10px] text-ink-3">
                {total} total{unread > 0 ? ` · ${unread} unread` : ""}
              </span>
            )}
          </div>
          {unread > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={markingAll}
              className="flex items-center gap-1 rounded-sm border border-line px-2 py-1 font-mono text-[10px] text-ink-3 hover:text-ink hover:bg-surface transition-colors disabled:opacity-50"
            >
              <CheckCheck size={11} />
              {markingAll ? "Marking…" : "Mark all read"}
            </button>
          )}
        </div>

        {loading ? (
          <div className="px-4 py-8 text-center font-mono text-[11px] text-ink-3">Loading…</div>
        ) : histError ? (
          <div className="px-4 py-8 text-center font-mono text-[11px] text-danger">{histError}</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-8 text-center font-mono text-[11px] text-ink-3">No notifications yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-line bg-surface">
                  {["Kind", "Title", "Received", "Status"].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-ink-3"
                    >
                      {h}
                    </th>
                  ))}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((n) => (
                  <tr
                    key={n.id}
                    className={`hover:bg-surface-2 transition-colors ${!n.readAt ? "bg-accent-soft/5" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <span className="rounded-sm border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
                        {n.kind || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-xs">
                      <span className={`${!n.readAt ? "font-semibold text-ink" : "text-ink-2"} truncate block`}>
                        {n.title}
                      </span>
                      {n.body && (
                        <span className="block truncate text-[10px] text-ink-3 mt-0.5">{n.body}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px] text-ink-3 whitespace-nowrap">
                      {n.createdAt ? fmtTs(n.createdAt) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {n.readAt ? (
                        <span className="font-mono text-[10px] text-ink-3">Read</span>
                      ) : (
                        <span className="rounded-full bg-accent px-1.5 py-0.5 font-mono text-[9px] text-white">
                          Unread
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {!n.readAt && (
                        <button
                          type="button"
                          onClick={() => handleMarkRead(n.id)}
                          title="Mark as read"
                          className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-3 hover:text-ink hover:bg-surface transition-colors"
                        >
                          <CheckCheck size={11} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Section 2: Channel Preferences ──────────────────────────────── */}
      <section className="rounded-sm border border-line bg-paper">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
            Channel Preferences
          </span>
          <div className="flex items-center gap-3">
            {prefSaved && (
              <span className="font-mono text-[10px] text-success">Saved locally.</span>
            )}
            <p className="font-mono text-[10px] text-ink-3">
              Preferences saved locally
            </p>
            <button
              type="button"
              onClick={handleSavePrefs}
              className="rounded-sm border border-accent bg-accent/10 px-2 py-1 font-mono text-[10px] text-accent hover:bg-accent/20 transition-colors"
            >
              Save Preferences
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-line bg-surface">
                <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-ink-3 w-64">
                  Notification Type
                </th>
                <th className="px-4 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-ink-3 w-24">
                  In-App
                </th>
                <th className="px-4 py-2 text-center font-mono text-[10px] uppercase tracking-wider text-ink-3 w-24">
                  Email
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {prefs.map((pref) => (
                <tr key={pref.id} className="hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-2.5 text-ink">{pref.label}</td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex justify-center">
                      <Toggle
                        checked={pref.inApp}
                        onChange={() => togglePref(pref.id, "inApp")}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <div className="flex justify-center">
                      <Toggle
                        checked={pref.email}
                        onChange={() => togglePref(pref.id, "email")}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
