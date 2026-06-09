"use client";

import { useEffect, useState } from "react";
import type { UserMeta } from "@/lib/auth/cookies";
import { decodeUserMeta } from "@/lib/auth/cookies";
import { useRouter } from "next/navigation";

function getUserMeta(): UserMeta | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie
    .split("; ")
    .find((c) => c.startsWith("user_meta="))
    ?.split("=")[1];
  if (!raw) return null;
  return decodeUserMeta(decodeURIComponent(raw));
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserMeta | null>(null);

  // ── Display name edit ────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSuccess, setNameSuccess] = useState(false);

  // ── Password change ──────────────────────────────────────────────────────
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);

  useEffect(() => {
    const meta = getUserMeta();
    if (!meta) {
      router.push("/login?next=/profile");
      return;
    }
    setUser(meta);
    setNameInput(meta.displayName);
  }, [router]);

  if (!user) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <div className="rounded-sm border border-line bg-paper p-5 font-mono text-[11px] text-ink-3">
          Loading…
        </div>
      </div>
    );
  }

  // ── Handlers ─────────────────────────────────────────────────────────────

  async function saveName() {
    if (!nameInput.trim()) {
      setNameError("Display name cannot be empty.");
      return;
    }
    setNameSaving(true);
    setNameError(null);
    try {
      const res = await fetch(`/api/identity/users/${user!.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: nameInput.trim() }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `HTTP ${res.status}`);
      }
      // Update the local cookie so future page loads reflect the change.
      const updated: UserMeta = { ...user!, displayName: nameInput.trim() };
      const encoded = btoa(JSON.stringify(updated));
      document.cookie = `user_meta=${encoded}; path=/; max-age=${30 * 24 * 3600}`;
      setUser(updated);
      setEditing(false);
      setNameSuccess(true);
      setTimeout(() => setNameSuccess(false), 3000);
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setNameSaving(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pwForm.current || !pwForm.next || !pwForm.confirm) {
      setPwError("All fields are required.");
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      setPwError("New passwords do not match.");
      return;
    }
    if (pwForm.next.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }
    setPwSaving(true);
    setPwError(null);
    try {
      const res = await fetch(`/api/identity/users/${user!.id}/password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ current_password: pwForm.current, password: pwForm.next }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          // non-JSON body — keep the status message
        }
        throw new Error(msg);
      }
      setPwForm({ current: "", next: "", confirm: "" });
      setPwOpen(false);
      setPwSuccess(true);
      setTimeout(() => setPwSuccess(false), 4000);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Password change failed");
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="rounded-sm border border-line bg-paper p-5">

        {/* ── Avatar + name header ─────────────────────────────────────── */}
        <div className="flex items-center gap-4 border-b border-line pb-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent font-mono text-lg font-semibold text-white">
            {user.displayName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  className="rounded-sm border border-line bg-surface px-2 py-1 font-mono text-[12px] text-ink focus:outline-none focus:ring-1 focus:ring-accent w-48"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveName();
                    if (e.key === "Escape") { setEditing(false); setNameInput(user.displayName); }
                  }}
                />
                <button
                  onClick={saveName}
                  disabled={nameSaving}
                  className="rounded-sm border border-accent bg-accent/10 px-2 py-1 font-mono text-[10px] text-accent hover:bg-accent/20 disabled:opacity-50"
                >
                  {nameSaving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => { setEditing(false); setNameInput(user.displayName); setNameError(null); }}
                  className="rounded-sm border border-line bg-surface px-2 py-1 font-mono text-[10px] text-ink-3 hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-semibold text-ink">{user.displayName}</span>
                <button
                  onClick={() => { setEditing(true); setNameInput(user.displayName); setNameError(null); }}
                  className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-3 hover:text-ink hover:bg-surface transition-colors"
                  title="Edit display name"
                >
                  Edit
                </button>
              </div>
            )}
            <div className="font-mono text-[11px] text-ink-3 mt-0.5">{user.email}</div>
            {nameError && (
              <p className="mt-1 font-mono text-[10px] text-danger">{nameError}</p>
            )}
            {nameSuccess && (
              <p className="mt-1 font-mono text-[10px] text-success">Display name updated.</p>
            )}
          </div>
        </div>

        {/* ── Identity fields ─────────────────────────────────────────── */}
        <dl className="mt-4 space-y-2 text-[12px]">
          <div className="flex gap-4">
            <dt className="w-28 font-mono text-[10px] uppercase tracking-wider text-ink-3">User ID</dt>
            <dd className="font-mono text-[11px] text-ink">{user.id}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-28 font-mono text-[10px] uppercase tracking-wider text-ink-3">Email</dt>
            <dd className="text-ink">{user.email}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-28 font-mono text-[10px] uppercase tracking-wider text-ink-3">Tenant</dt>
            <dd className="text-ink">
              {user.tenantSlug ?? "—"}
              {user.tenantId && (
                <span className="ml-1 font-mono text-[10px] text-ink-3">({user.tenantId})</span>
              )}
            </dd>
          </div>
        </dl>

        {/* ── Change password section ──────────────────────────────────── */}
        <div className="border-t border-line mt-4 pt-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Security</span>
            <button
              onClick={() => { setPwOpen((v) => !v); setPwError(null); }}
              className="rounded-sm border border-line px-2 py-1 font-mono text-[10px] text-ink-3 hover:text-ink hover:bg-surface transition-colors"
            >
              {pwOpen ? "Cancel" : "Change Password"}
            </button>
          </div>

          {pwSuccess && (
            <p className="mt-2 font-mono text-[10px] text-success">Password updated successfully.</p>
          )}

          {pwOpen && (
            <form onSubmit={changePassword} className="mt-3 space-y-3">
              {[
                { id: "cur", label: "Current Password", key: "current" as const },
                { id: "nxt", label: "New Password", key: "next" as const },
                { id: "cnf", label: "Confirm New Password", key: "confirm" as const },
              ].map(({ id, label, key }) => (
                <div key={id} className="flex items-center gap-4">
                  <label htmlFor={id} className="w-40 font-mono text-[10px] uppercase tracking-wider text-ink-3 shrink-0">
                    {label}
                  </label>
                  <input
                    id={id}
                    type="password"
                    autoComplete={key === "current" ? "current-password" : "new-password"}
                    className="flex-1 rounded-sm border border-line bg-surface px-2 py-1 font-mono text-[12px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                    value={pwForm[key]}
                    onChange={(e) => setPwForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </div>
              ))}

              {pwError && (
                <p className="font-mono text-[10px] text-danger">{pwError}</p>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={pwSaving}
                  className="rounded-sm border border-accent bg-accent/10 px-3 py-1.5 font-mono text-[11px] text-accent hover:bg-accent/20 disabled:opacity-50"
                >
                  {pwSaving ? "Saving…" : "Update Password"}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* ── Sessions placeholder ─────────────────────────────────────── */}
        <div className="border-t border-line mt-4 pt-4">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Active Sessions &amp; API Tokens</span>
          <p className="mt-2 rounded-sm border border-line bg-surface px-3 py-2 font-mono text-[11px] text-ink-3">
            Session management and API token issuance will be available in a future release.
          </p>
        </div>

        {/* ── Sign out ─────────────────────────────────────────────────── */}
        <form action="/api/auth/signout" method="POST" className="mt-4">
          <button
            type="submit"
            className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-1.5 font-mono text-[11px] text-danger hover:bg-danger/20"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
