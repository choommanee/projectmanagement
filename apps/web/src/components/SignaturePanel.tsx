"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, PenLine, Plus, XCircle } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthProvider";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Signature {
  id: string;
  signerId: string;
  signerEmail: string;
  status: "pending" | "signed" | "declined";
  requestedAt: string;
  signedAt?: string;
  declinedAt?: string;
  declineReason?: string;
  signatureHash?: string;
}

interface SignaturePanelProps {
  documentId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeDate(iso: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function signerInitials(signerId: string): string {
  return signerId.slice(-2).toUpperCase();
}

function signerShort(signerId: string): string {
  return signerId.slice(-8);
}

// ─── SignaturePanel ───────────────────────────────────────────────────────────

export function SignaturePanel({ documentId }: SignaturePanelProps) {
  const { user } = useAuth();
  const currentUserId = user?.id;

  const [sigs, setSigs] = useState<Signature[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [newSignerIds, setNewSignerIds] = useState("");
  const [busy, setBusy] = useState(false);

  const loadSigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/documents/${documentId}/signatures`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      const data = await r.json() as { items?: Signature[] } | Signature[];
      setSigs(Array.isArray(data) ? data : (data.items ?? []));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => { void loadSigs(); }, [loadSigs]);

  async function requestSignatures() {
    const ids = newSignerIds.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/documents/${documentId}/signatures`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signers: ids.map((id) => ({ id, email: "" })) }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      setNewSignerIds("");
      setRequesting(false);
      await loadSigs();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function signDoc(sigId: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/documents/${documentId}/signatures/${sigId}/sign`, { method: "POST" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      await loadSigs();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function declineDoc(sigId: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/documents/${documentId}/signatures/${sigId}/decline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "declined" }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      await loadSigs();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pendingCount = sigs.filter((s) => s.status === "pending").length;

  return (
    <div className="border-t border-line">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <PenLine size={13} className="text-ink-3" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-ink-3">
            Signatures
          </span>
          {pendingCount > 0 && (
            <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-warning/10 px-1 font-mono text-[9px] font-semibold text-warning">
              {pendingCount}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label="Request signatures"
          onClick={() => setRequesting((r) => !r)}
          className="text-ink-3 hover:text-ink transition-colors"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* Request form */}
      {requesting && (
        <div className="border-t border-line bg-surface-2 px-4 py-3 space-y-2">
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-ink-3">
            Request Signatures
          </label>
          <input
            className="h-7 w-full rounded-xs border border-line bg-surface px-2 text-[12px] text-ink focus:border-accent focus:outline-none"
            placeholder="User ID (comma-separated)"
            value={newSignerIds}
            onChange={(e) => setNewSignerIds(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void requestSignatures();
              if (e.key === "Escape") setRequesting(false);
            }}
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setRequesting(false)}
              className="h-6 rounded-xs px-3 text-[11px] font-medium text-ink-3 hover:text-ink transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !newSignerIds.trim()}
              onClick={() => void requestSignatures()}
              className="h-6 rounded-xs bg-accent px-3 text-[11px] font-semibold text-surface hover:bg-accent-hover disabled:opacity-50 transition-colors"
            >
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 border-t border-danger/30 bg-danger/5 px-4 py-1.5">
          <span className="flex-1 font-mono text-[11px] text-danger">{error}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
            className="text-danger/60 hover:text-danger text-[12px]"
          >
            ×
          </button>
        </div>
      )}

      {/* Signature list */}
      <div className="px-4 pb-3 space-y-2">
        {loading && (
          <p className="font-mono text-[11px] text-ink-3 animate-pulse">Loading…</p>
        )}

        {!loading && sigs.length === 0 && (
          <p className="font-mono text-[11px] text-ink-3">No signatures requested.</p>
        )}

        {sigs.map((sig) => (
          <div key={sig.id} className="rounded-xs border border-line bg-surface-2 px-3 py-2 space-y-1.5">
            {/* Signer row */}
            <div className="flex items-center gap-2">
              {/* Avatar */}
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 font-mono text-[9px] font-semibold text-accent">
                {signerInitials(sig.signerId)}
              </span>
              {/* ID */}
              <span className="flex-1 truncate font-mono text-[11px] text-ink-2">
                {signerShort(sig.signerId)}
              </span>
              {/* Status badge */}
              {sig.status === "pending" && (
                <span className="inline-flex items-center gap-1 rounded-xs bg-warning/5 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-warning">
                  <Clock size={9} />
                  Pending
                </span>
              )}
              {sig.status === "signed" && (
                <span className="inline-flex items-center gap-1 rounded-xs bg-success/5 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-success">
                  <CheckCircle2 size={9} />
                  Signed
                </span>
              )}
              {sig.status === "declined" && (
                <span className="inline-flex items-center gap-1 rounded-xs bg-danger/5 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-danger">
                  <XCircle size={9} />
                  Declined
                </span>
              )}
            </div>

            {/* Signed / declined metadata */}
            {sig.status === "signed" && sig.signedAt && (
              <p className="font-mono text-[10px] text-ink-3 pl-8">
                Signed {relativeDate(sig.signedAt)}
              </p>
            )}
            {sig.status === "declined" && sig.declinedAt && (
              <p className="font-mono text-[10px] text-ink-3 pl-8">
                Declined {relativeDate(sig.declinedAt)}
                {sig.declineReason ? ` — ${sig.declineReason}` : ""}
              </p>
            )}

            {/* Actions — only shown to the assignee when pending */}
            {sig.signerId === currentUserId && sig.status === "pending" && (
              <div className="flex gap-1.5 pl-8">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void signDoc(sig.id)}
                  className="inline-flex items-center gap-1 rounded-xs bg-success/5 px-2 py-0.5 font-mono text-[10px] font-semibold text-success hover:bg-success/10 disabled:opacity-50 transition-colors"
                >
                  <CheckCircle2 size={10} />
                  Sign Document
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void declineDoc(sig.id)}
                  className="inline-flex items-center gap-1 rounded-xs bg-danger/5 px-2 py-0.5 font-mono text-[10px] font-semibold text-danger hover:bg-danger/10 disabled:opacity-50 transition-colors"
                >
                  <XCircle size={10} />
                  Decline
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
