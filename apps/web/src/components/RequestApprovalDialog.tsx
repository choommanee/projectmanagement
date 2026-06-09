"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Trash2, UserPlus } from "lucide-react";
import { Dialog, Button, Select } from "@pmplatform/ui-kit";
import { useAuth } from "@/lib/auth/AuthProvider";
import { listUsers, type UserSummary } from "@/lib/api/identity";
import { ensureDocApprovalWorkflow, startInstance } from "@/lib/api/workflows";

interface Props {
  open: boolean;
  documentId: string;
  projectId: string;
  onClose: () => void;
}

interface DraftSigner {
  signerId: string;
  name: string;
  email: string;
}

/**
 * Launcher for the Document-Approval-with-signature flow.
 *
 * Collects an approver + a list of signers, then:
 *   1. find-or-create the seeded "Document Approval (Project)" workflow (published),
 *   2. POST start with input { project_id, document_id, approver_id, requester_id, signers },
 *   3. route to the new instance's run page.
 */
export function RequestApprovalDialog({ open, documentId, projectId, onClose }: Props) {
  const t = useTranslations("approval");
  const router = useRouter();
  const { user } = useAuth();

  const [users, setUsers] = useState<UserSummary[]>([]);
  const [approverId, setApproverId] = useState("");
  const [signers, setSigners] = useState<DraftSigner[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setStep(null);
    void listUsers(undefined, 200).then(setUsers).catch(() => setUsers([]));
  }, [open]);

  function addSigner() {
    setSigners((prev) => [...prev, { signerId: "", name: "", email: "" }]);
  }
  function removeSigner(i: number) {
    setSigners((prev) => prev.filter((_, idx) => idx !== i));
  }
  function pickSigner(i: number, userId: string) {
    const u = users.find((x) => x.id === userId);
    setSigners((prev) =>
      prev.map((s, idx) =>
        idx === i ? { signerId: userId, name: u?.display_name ?? "", email: u?.email ?? "" } : s,
      ),
    );
  }

  async function start() {
    if (!approverId) { setError(t("noApprover")); return; }
    const valid = signers.filter((s) => s.signerId.trim());
    if (valid.length === 0) { setError(t("noSigners")); return; }
    if (!projectId) { setError(t("noProject")); return; }

    setBusy(true);
    setError(null);
    try {
      // 1. find-or-create-and-publish the approval workflow.
      setStep(t("preparing"));
      const def = await ensureDocApprovalWorkflow();

      // 2. start with the approval-template start input.
      setStep(t("starting"));
      const inst = await startInstance(def.id, {
        input: {
          project_id: projectId,
          document_id: documentId,
          approver_id: approverId,
          requester_id: user?.id ?? "",
          signers: valid.map((s) => ({
            signer_id: s.signerId,
            name: s.name || undefined,
            email: s.email || undefined,
          })),
        },
      });

      // 3. route to the run page.
      router.push(`/pm/workflows/${def.id}/runs/${inst.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep(null);
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("dialogTitle")} size="lg">
      <div className="space-y-4">
        {/* approver */}
        <div className="space-y-1">
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-ink-3">
            {t("approver")}
          </label>
          <Select
            value={approverId}
            onChange={setApproverId}
            placeholder={t("pickApprover")}
            options={users.map((u) => ({
              label: `${u.display_name || u.email} · ${u.email}`,
              value: u.id,
            }))}
          />
          <p className="text-[10px] text-ink-3">{t("approverHint")}</p>
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
            <div key={i} className="flex items-center gap-2 rounded-xs border border-line bg-surface-2 p-2.5">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/10 font-mono text-[10px] font-semibold text-accent">
                {i + 1}
              </span>
              <div className="flex-1">
                <Select
                  value={s.signerId}
                  onChange={(v) => pickSigner(i, v)}
                  placeholder={t("pickSigner")}
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
          ))}
        </div>

        {step && !error && (
          <p className="rounded-xs border border-info/30 bg-info/5 px-3 py-2 font-mono text-[11px] text-info">
            {step}
          </p>
        )}
        {error && (
          <p className="rounded-xs border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button variant="primary" onClick={() => void start()} loading={busy} disabled={busy}>
            {busy ? t("starting") : t("start")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
