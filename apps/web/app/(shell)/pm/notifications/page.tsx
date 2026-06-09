"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AppNotification } from "@/lib/api/notifications";
import { listNotifications, markRead, markAllRead } from "@/lib/api/notifications";
import { CheckCheck } from "lucide-react";

// ── Notification preferences data shape ────────────────────────────────────

interface KindPref {
  id: string;
  label: string;
  inApp: boolean;
  email: boolean;
}

// Canonical event kinds — matches notification-svc event kinds
const EVENT_KIND_LABELS: Record<string, string> = {
  "task.assigned":          "Task assigned",
  "task.blocked":           "Task blocked",
  "task.commented":         "Task commented",
  "project.created":        "Project created",
  "project.updated":        "Project updated",
  "document.sign_requested": "Document sign requested",
  "comment.added":          "Comment added",
  "sprint.started":         "Sprint started",
  "sprint.completed":       "Sprint completed",
  "wo.status":              "Work order status change",
  "mention":                "Mention (@)",
};

// Channels supported in the backend (notification_preference table).
// These MUST match the channel Name() values in notification-svc
// (InAppChannel → "inapp", EmailChannel → "email"); the delivery Router
// matches preferences against those exact strings.
const CHANNELS = ["inapp", "email"] as const;
type Channel = (typeof CHANNELS)[number];

// Default preferences when API is unavailable
const DEFAULT_KIND_PREFS: KindPref[] = [
  { id: "task.assigned",          label: "Task assigned",              inApp: true,  email: true  },
  { id: "task.blocked",           label: "Task blocked",               inApp: true,  email: false },
  { id: "task.commented",         label: "Task commented",             inApp: true,  email: false },
  { id: "project.created",        label: "Project created",            inApp: true,  email: true  },
  { id: "project.updated",        label: "Project updated",            inApp: true,  email: false },
  { id: "document.sign_requested", label: "Document sign requested",   inApp: true,  email: true  },
  { id: "comment.added",          label: "Comment added",              inApp: true,  email: false },
  { id: "sprint.started",         label: "Sprint started",             inApp: true,  email: true  },
  { id: "sprint.completed",       label: "Sprint completed",           inApp: true,  email: false },
  { id: "wo.status",              label: "Work order status change",   inApp: true,  email: false },
  { id: "mention",                label: "Mention (@)",                inApp: true,  email: true  },
];

// API response shape: [{ kind: string, channels: string[] }]
interface ApiPref {
  kind: string;
  channels: string[];
}

// Convert API response → UI prefs
function fromApiPrefs(apiPrefs: ApiPref[]): KindPref[] {
  return DEFAULT_KIND_PREFS.map((def) => {
    const found = apiPrefs.find((p) => p.kind === def.id);
    if (found) {
      return {
        id: def.id,
        label: EVENT_KIND_LABELS[def.id] ?? def.id,
        inApp: found.channels.includes("inapp"),
        email: found.channels.includes("email"),
      };
    }
    return def;
  });
}

// Convert UI prefs → API payload
function toApiPrefs(prefs: KindPref[]): ApiPref[] {
  return prefs.map((p) => {
    const channels: Channel[] = [];
    if (p.inApp) channels.push("inapp");
    if (p.email) channels.push("email");
    return { kind: p.id, channels };
  });
}

const PREF_STORAGE_KEY = "notif_channel_prefs_v2";

function loadLocalPrefs(): KindPref[] | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PREF_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as KindPref[];
  } catch {
    return null;
  }
}

function saveLocalPrefs(prefs: KindPref[]) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(prefs));
  }
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

// ── Toggle switch primitive ──────────────────────────────────────────────────
interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}
function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked ? "true" : "false"}
      aria-label={label ?? (checked ? "On" : "Off")}
      title={label ?? (checked ? "On" : "Off")}
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

// ── Main Page ────────────────────────────────────────────────────────────────

export default function NotificationPrefsPage() {
  // ── Notification history state ────────────────────────────────────────────
  const [items, setItems] = useState<AppNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [histError, setHistError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  // ── Channel prefs state ───────────────────────────────────────────────────
  const [prefs, setPrefs] = useState<KindPref[]>(DEFAULT_KIND_PREFS);
  const [prefLoading, setPrefLoading] = useState(true);
  const [prefError, setPrefError] = useState<string | null>(null);
  const [prefSaving, setPrefSaving] = useState(false);
  const [prefSaved, setPrefSaved] = useState(false);
  const [prefDirty, setPrefDirty] = useState(false);
  const [prefSource, setPrefSource] = useState<"api" | "local" | "default">("default");

  // Debounce save timer
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load notification history ─────────────────────────────────────────────
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

  // ── Load preferences from API (with localStorage fallback) ────────────────
  useEffect(() => {
    let cancelled = false;
    setPrefLoading(true);
    setPrefError(null);

    fetch("/api/notifications/preferences")
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<{ preferences: ApiPref[] } | ApiPref[]>;
      })
      .then((data) => {
        if (cancelled) return;
        const apiList: ApiPref[] = Array.isArray(data) ? data : (data as { preferences: ApiPref[] }).preferences ?? [];
        const loaded = fromApiPrefs(apiList);
        setPrefs(loaded);
        setPrefSource("api");
      })
      .catch(() => {
        if (cancelled) return;
        // Fall back to localStorage, then defaults
        const local = loadLocalPrefs();
        if (local) {
          setPrefs(local);
          setPrefSource("local");
        } else {
          setPrefs(DEFAULT_KIND_PREFS);
          setPrefSource("default");
        }
        // Don't set error — silently fall back; the save button will persist locally
      })
      .finally(() => {
        if (!cancelled) setPrefLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────
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
    setPrefDirty(true);
    setPrefSaved(false);
    // Debounce auto-save 1.5s
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void handleSavePrefs();
    }, 1500);
  }

  async function handleSavePrefs() {
    setPrefSaving(true);
    setPrefError(null);
    try {
      const payload = toApiPrefs(prefs);
      const r = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.ok) {
        setPrefSource("api");
      } else {
        // API unavailable — persist locally
        saveLocalPrefs(prefs);
        setPrefSource("local");
      }
      setPrefSaved(true);
      setPrefDirty(false);
      setTimeout(() => setPrefSaved(false), 3000);
    } catch {
      // Offline — save to localStorage
      saveLocalPrefs(prefs);
      setPrefSource("local");
      setPrefSaved(true);
      setPrefDirty(false);
      setTimeout(() => setPrefSaved(false), 3000);
    } finally {
      setPrefSaving(false);
    }
  }

  const unread = items.filter((n) => !n.readAt).length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 space-y-6">

      {/* ── Page header ───────────────────────────────────────────────────── */}
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

      {/* ── Section 1: Notification History ───────────────────────────────── */}
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
                  <th className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-3 sr-only">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((n) => (
                  <tr
                    key={n.id}
                    className={`hover:bg-surface-2 transition-colors ${!n.readAt ? "bg-accent/5" : ""}`}
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

      {/* ── Section 2: Channel Preferences ────────────────────────────────── */}
      <section className="rounded-sm border border-line bg-paper">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
              Channel Preferences
            </span>
            {/* Source badge */}
            {!prefLoading && (
              <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded-xs border ${
                prefSource === "api"
                  ? "border-success/30 bg-success/5 text-success"
                  : prefSource === "local"
                  ? "border-warning/30 bg-warning/5 text-warning"
                  : "border-line text-ink-3"
              }`}>
                {prefSource === "api" ? "synced" : prefSource === "local" ? "local" : "default"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {prefError && (
              <span className="font-mono text-[10px] text-danger">{prefError}</span>
            )}
            {prefSaved && !prefSaving && (
              <span className="font-mono text-[10px] text-success">
                {prefSource === "api" ? "Saved to server." : "Saved locally."}
              </span>
            )}
            {prefDirty && !prefSaving && (
              <span className="font-mono text-[10px] text-ink-3">Unsaved changes</span>
            )}
            <button
              type="button"
              onClick={() => { void handleSavePrefs(); }}
              disabled={prefSaving || prefLoading}
              className="rounded-sm border border-accent bg-accent/10 px-2 py-1 font-mono text-[10px] text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
            >
              {prefSaving ? "Saving…" : "Save Preferences"}
            </button>
          </div>
        </div>

        {prefLoading ? (
          <div className="px-4 py-8 text-center font-mono text-[11px] text-ink-3">Loading preferences…</div>
        ) : (
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
                    <td className="px-4 py-2.5">
                      <span className="text-ink">{pref.label}</span>
                      <span className="ml-2 font-mono text-[9px] text-ink-3">{pref.id}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex justify-center">
                        <Toggle
                          checked={pref.inApp}
                          label={`${pref.label} in-app notifications`}
                          onChange={() => togglePref(pref.id, "inApp")}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <div className="flex justify-center">
                        <Toggle
                          checked={pref.email}
                          label={`${pref.label} email notifications`}
                          onChange={() => togglePref(pref.id, "email")}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
