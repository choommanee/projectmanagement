"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2, UserPlus } from "lucide-react";
import { Dialog, Button, Select } from "@pmplatform/ui-kit";
import { listUsers, type UserSummary } from "@/lib/api/identity";
import {
  createEnvelope,
  sendEnvelope,
  type AuthMethod,
  type SigningOrder,
  type Envelope,
} from "@/lib/api/signing";

interface DraftSigner {
  signerId: string;
  name: string;
  email: string;
  authMethod: AuthMethod;
}

interface Props {
  open: boolean;
  documentId: string;
  onClose: () => void;
  onCreated: (env: Envelope) => void;
}

const AUTH_METHODS: AuthMethod[] = ["session", "email_otp", "sso", "typed_name"];

export function CreateEnvelopeDialog({ open, documentId, onClose, onCreated }: Props) {
  const t = useTranslations("signing");

  const [title, setTitle] = useState("");
  const [order, setOrder] = useState<SigningOrder>("sequential");
  const [expiresAt, setExpiresAt] = useState("");
  const [signers, setSigners] = useState<DraftSigner[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void listUsers(undefined, 200).then(setUsers).catch(() => setUsers([]));
  }, [open]);

  function addSigner() {
    setSigners((prev) => [...prev, { signerId: "", name: "", email: "", authMethod: "session" }]);
  }
  function removeSigner(i: number) {
    setSigners((prev) => prev.filter((_, idx) => idx !== i));
  }
  function patchSigner(i: number, patch: Partial<DraftSigner>) {
    setSigners((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function pickUser(i: number, userId: string) {
    const u = users.find((x) => x.id === userId);
    patchSigner(i, {
      signerId: userId,
      name: u?.display_name ?? "",
      email: u?.email ?? "",
    });
  }

  async function submit(sendNow: boolean) {
    const valid = signers.filter((s) => s.signerId.trim());
    if (valid.length === 0) {
      setError(t("noSigners"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const env = await createEnvelope(documentId, {
        title: title.trim() || undefined,
        signing_order: order,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        signers: valid.map((s) => ({
          signer_id: s.signerId,
          name: s.name || undefined,
          email: s.email || undefined,
          auth_method: s.authMethod,
        })),
      });
      const final = sendNow ? await sendEnvelope(env.id) : env;
      onCreated(final);
      // reset
      setTitle("");
      setOrder("sequential");
      setExpiresAt("");
      setSigners([]);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("createEnvelope")} size="xl">
      <div className="space-y-4">
        {/* title */}
        <div className="space-y-1">
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-ink-3">
            {t("envelopeTitle")}
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("envelopeTitlePlaceholder")}
            className="h-9 w-full rounded-xs border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none"
          />
        </div>

        {/* order + expiry */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-ink-3">
              {t("signingOrder")}
            </label>
            <Select
              value={order}
              onChange={(v) => setOrder(v as SigningOrder)}
              options={[
                { label: t("sequential"), value: "sequential" },
                { label: t("parallel"), value: "parallel" },
              ]}
            />
            <p className="text-[10px] text-ink-3">
              {order === "sequential" ? t("sequentialHint") : t("parallelHint")}
            </p>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] font-semibold uppercase tracking-widest text-ink-3">
              {t("expiresAt")}
            </label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="h-9 w-full rounded-xs border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {/* signers */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-ink-3">
              {t("signers")}
            </label>
            <Button variant="outline" size="sm" onClick={addSigner}>
              <UserPlus size={12} /> {t("addSigner")}
            </Button>
          </div>

          {signers.length === 0 && (
            <p className="rounded-xs border border-dashed border-line bg-surface-2 px-3 py-4 text-center font-mono text-[11px] text-ink-3">
              {t("noSigners")}
            </p>
          )}

          {signers.map((s, i) => (
            <div key={i} className="rounded-xs border border-line bg-surface-2 p-2.5">
              <div className="flex items-center gap-2">
                {order === "sequential" && (
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 font-mono text-[10px] font-semibold text-accent">
                    {i + 1}
                  </span>
                )}
                <div className="flex-1">
                  <Select
                    value={s.signerId}
                    onChange={(v) => pickUser(i, v)}
                    placeholder={t("pickUser")}
                    options={users.map((u) => ({
                      label: `${u.display_name || u.email} · ${u.email}`,
                      value: u.id,
                    }))}
                  />
                </div>
                <button
                  type="button"
                  aria-label={t("removeSigner")}
                  onClick={() => removeSigner(i)}
                  className="text-ink-3 transition-colors hover:text-danger"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="mt-2 grid grid-cols-[1fr_1fr_140px] gap-2">
                <input
                  value={s.name}
                  onChange={(e) => patchSigner(i, { name: e.target.value })}
                  placeholder={t("signerName")}
                  className="h-7 rounded-xs border border-line bg-surface px-2 text-[12px] text-ink focus:border-accent focus:outline-none"
                />
                <input
                  value={s.email}
                  onChange={(e) => patchSigner(i, { email: e.target.value })}
                  placeholder={t("signerEmail")}
                  className="h-7 rounded-xs border border-line bg-surface px-2 text-[12px] text-ink focus:border-accent focus:outline-none"
                />
                <Select
                  size="sm"
                  value={s.authMethod}
                  onChange={(v) => patchSigner(i, { authMethod: v as AuthMethod })}
                  options={AUTH_METHODS.map((m) => ({ label: m, value: m }))}
                />
              </div>
            </div>
          ))}
        </div>

        {error && (
          <p className="rounded-xs border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button variant="secondary" onClick={() => void submit(false)} loading={busy} disabled={busy}>
            {t("createDraft")}
          </Button>
          <Button variant="primary" onClick={() => void submit(true)} loading={busy} disabled={busy}>
            {t("createAndSend")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
