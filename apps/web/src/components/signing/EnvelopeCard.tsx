"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  CheckCircle2, ChevronDown, ChevronRight, Clock, Copy, Download, ExternalLink,
  FileCheck2, Link2, Send, ShieldAlert, ShieldCheck, Slash, XCircle,
} from "lucide-react";
import { Tag, Button, Dialog } from "@pmplatform/ui-kit";
import {
  sendEnvelope,
  voidEnvelope,
  verifyEnvelope,
  listEnvelopeAudit,
  downloadEnvelopeCertificate,
  getEnvelope,
  createVerifyLink,
  type CreatedVerifyLink,
  type Envelope,
  type SignEvent,
  type VerifyResult,
} from "@/lib/api/signing";
import { ENVELOPE_TONE, SIGNER_TONE, ROUTING_TONE, relativeDate, absDate, initials } from "./signingUi";
import { SignNowCard } from "./SignNowCard";
import { AuditTrail } from "./AuditTrail";

interface Props {
  envelope: Envelope;
  currentUserId?: string;
  currentUserName?: string;
  onChanged: (env: Envelope) => void;
}

export function EnvelopeCard({ envelope, currentUserId, currentUserName, onChanged }: Props) {
  const t = useTranslations("signing");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  const [audit, setAudit] = useState<SignEvent[] | null>(null);
  const [showVoid, setShowVoid] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [downloading, setDownloading] = useState(false);

  // public verification link (shown once after creation)
  const [verifyLink, setVerifyLink] = useState<CreatedVerifyLink | null>(null);
  const [creatingLink, setCreatingLink] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const reload = useCallback(async () => {
    try {
      onChanged(await getEnvelope(envelope.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [envelope.id, onChanged]);

  // the current user's signer row (if they are a signer)
  const mySigner = envelope.signers.find((s) => s.signerId === currentUserId);
  const myTurn =
    !!mySigner &&
    mySigner.status === "pending" &&
    (envelope.signingOrder === "parallel" || mySigner.routingStatus === "active") &&
    envelope.status === "sent";

  const isCreator = !!currentUserId && envelope.createdBy === currentUserId;
  const signedCount = envelope.signers.filter((s) => s.status === "signed").length;

  async function send() {
    setBusy(true); setError(null);
    try { onChanged(await sendEnvelope(envelope.id)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function doVoid() {
    if (!voidReason.trim()) return;
    setBusy(true); setError(null);
    try {
      onChanged(await voidEnvelope(envelope.id, voidReason.trim()));
      setShowVoid(false); setVoidReason("");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function runVerify() {
    setVerifying(true); setError(null);
    try { setVerify(await verifyEnvelope(envelope.id)); }
    catch (e) { setError((e as Error).message); }
    finally { setVerifying(false); }
  }

  async function loadAudit() {
    try { setAudit(await listEnvelopeAudit(envelope.id)); }
    catch (e) { setError((e as Error).message); }
  }

  async function download() {
    setDownloading(true); setError(null);
    try { await downloadEnvelopeCertificate(envelope.id, `certificate-${envelope.title || envelope.id}.pdf`); }
    catch (e) { setError((e as Error).message); }
    finally { setDownloading(false); }
  }

  async function makeVerifyLink() {
    setCreatingLink(true); setError(null); setLinkCopied(false);
    try { setVerifyLink(await createVerifyLink(envelope.id)); }
    catch (e) { setError((e as Error).message); }
    finally { setCreatingLink(false); }
  }

  async function copyVerifyLink() {
    if (!verifyLink) return;
    try {
      await navigator.clipboard.writeText(verifyLink.publicUrl);
      setLinkCopied(true);
    } catch {
      setLinkCopied(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && audit == null) void loadAudit();
  }

  return (
    <div className="rounded-xs border border-line bg-surface">
      {/* header */}
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        {open ? <ChevronDown size={14} className="text-ink-3" /> : <ChevronRight size={14} className="text-ink-3" />}
        <span className="flex-1 truncate text-[13px] font-semibold text-ink">
          {envelope.title || t("title")}
        </span>
        <span className="font-mono text-[10px] text-ink-3">
          {signedCount}/{envelope.signers.length}
        </span>
        <Tag tone={ENVELOPE_TONE[envelope.status]} size="sm">
          {t(`status.${envelope.status}`)}
        </Tag>
      </button>

      {open && (
        <div className="space-y-4 border-t border-line px-3 py-3">
          {/* meta */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-ink-3">
            <span>{envelope.signingOrder === "sequential" ? t("sequential") : t("parallel")}</span>
            {envelope.expiresAt && <span>{t("expiresAt")}: {absDate(envelope.expiresAt)}</span>}
            {envelope.completedAt && <span>{t("signedOn")}: {relativeDate(envelope.completedAt)}</span>}
            {envelope.voidReason && <span className="text-warning">{envelope.voidReason}</span>}
          </div>

          {/* signer stepper / progress */}
          <ol className="space-y-2">
            {envelope.signers.map((s, i) => (
              <li key={s.id} className="flex items-start gap-2.5">
                <div className="flex flex-col items-center">
                  <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold ${
                    s.status === "signed" ? "bg-success/10 text-success"
                    : s.status === "declined" ? "bg-danger/10 text-danger"
                    : s.routingStatus === "active" ? "bg-accent/10 text-accent ring-1 ring-accent/40"
                    : "bg-surface-2 text-ink-3"
                  }`}>
                    {s.status === "signed" ? <CheckCircle2 size={13} />
                      : s.status === "declined" ? <XCircle size={13} />
                      : envelope.signingOrder === "sequential" ? i + 1
                      : initials(s.signerName, s.signerId)}
                  </span>
                  {i < envelope.signers.length - 1 && <span className="mt-1 h-4 w-px bg-line" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[12px] font-medium text-ink">
                      {s.signerName || s.signerId.slice(-8)}
                    </span>
                    <Tag tone={SIGNER_TONE[s.status]} size="sm">{t(`signerStatus.${s.status}`)}</Tag>
                    {s.status === "pending" && (
                      <Tag tone={ROUTING_TONE[s.routingStatus]} size="sm">{t(`routingStatus.${s.routingStatus}`)}</Tag>
                    )}
                  </div>
                  {s.signerEmail && <p className="truncate font-mono text-[10px] text-ink-3">{s.signerEmail}</p>}
                  <p className="font-mono text-[10px] text-ink-3">
                    {s.signedAt && `${t("signedOn")} ${relativeDate(s.signedAt)}`}
                    {s.declinedAt && `${t("declinedOn")} ${relativeDate(s.declinedAt)}${s.declineReason ? ` — ${s.declineReason}` : ""}`}
                    {!s.signedAt && !s.declinedAt && s.viewedAt && `${t("viewedOn")} ${relativeDate(s.viewedAt)}`}
                    {s.consent && <span className="ml-2 text-success">✓ {t("consentGiven")}</span>}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {/* SIGN NOW — current user's turn */}
          {myTurn && mySigner && (
            <SignNowCard
              envelope={envelope}
              signer={mySigner}
              defaultName={currentUserName}
              onSigned={(env) => { onChanged(env); void loadAudit(); }}
              onDeclined={() => { void reload(); void loadAudit(); }}
            />
          )}

          {/* verify result */}
          {verify && (
            <div className={`flex items-start gap-2 rounded-xs border px-3 py-2 ${
              verify.valid ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5"
            }`}>
              {verify.valid ? <ShieldCheck size={15} className="mt-0.5 shrink-0 text-success" />
                : <ShieldAlert size={15} className="mt-0.5 shrink-0 text-danger" />}
              <div className="space-y-1">
                <p className={`text-[12px] font-medium ${verify.valid ? "text-success" : "text-danger"}`}>
                  {verify.valid ? t("integrityValid") : t("integrityInvalid")}
                  {verify.reason ? ` — ${verify.reason}` : ""}
                </p>
                {verify.links.map((l) => (
                  <p key={l.signerId} className="font-mono text-[10px] text-ink-3">
                    #{l.orderIndex + 1} · {t("contentMatches")}: {l.contentMatches ? "✓" : "✗"} · {t("chainMatches")}: {l.chainMatches ? "✓" : "✗"}
                    {l.recordSigValid !== undefined && (
                      <> · {t("recordSig")}: {l.recordSigValid ? "✓" : "✗"}</>
                    )}
                  </p>
                ))}
                {verify.eventChain && (
                  <p className="font-mono text-[10px] text-ink-3">
                    {t("eventChain")}:{" "}
                    {verify.eventChain === "valid" ? t("eventChainValid")
                      : verify.eventChain === "invalid" ? t("eventChainInvalid")
                      : verify.eventChain === "legacy" ? t("eventChainLegacy")
                      : t("eventChainEmpty")}
                  </p>
                )}
              </div>
            </div>
          )}

          {error && <p className="font-mono text-[11px] text-danger">{error}</p>}

          {/* actions */}
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {envelope.status === "draft" && isCreator && (
              <Button variant="primary" size="sm" onClick={() => void send()} loading={busy} disabled={busy}>
                <Send size={12} /> {t("send")}
              </Button>
            )}
            {(envelope.status === "draft" || envelope.status === "sent") && isCreator && (
              <Button variant="secondary" size="sm" onClick={() => setShowVoid(true)} disabled={busy}>
                <Slash size={12} /> {t("voidEnvelope")}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void runVerify()} loading={verifying} disabled={verifying}>
              <ShieldCheck size={12} /> {verifying ? t("verifying") : t("verifyIntegrity")}
            </Button>
            {envelope.status === "completed" && (
              <Button variant="outline" size="sm" onClick={() => void download()} loading={downloading} disabled={downloading}>
                {downloading ? <Download size={12} /> : <FileCheck2 size={12} />}
                {downloading ? t("downloading") : t("downloadCertificate")}
              </Button>
            )}
            {envelope.status === "completed" && (
              <Button variant="outline" size="sm" onClick={() => void makeVerifyLink()} loading={creatingLink} disabled={creatingLink}>
                <Link2 size={12} /> {t("verifyLinkCreate")}
              </Button>
            )}
          </div>

          {/* audit */}
          <div className="border-t border-line pt-3">
            <div className="mb-2 flex items-center gap-2">
              <Clock size={12} className="text-ink-3" />
              <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-ink-3">
                {t("auditTrail")}
              </span>
            </div>
            <AuditTrail events={audit ?? []} />
          </div>
        </div>
      )}

      {/* public verification link dialog — token is shown exactly once */}
      <Dialog open={verifyLink != null} onClose={() => setVerifyLink(null)} title={t("verifyLinkTitle")} size="sm">
        <div className="space-y-3">
          <p className="text-[11px] leading-relaxed text-ink-3">{t("verifyLinkHint")}</p>
          <p className="break-all rounded-xs border border-line bg-surface-2 p-2 font-mono text-[10px] text-ink">
            {verifyLink?.publicUrl}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setVerifyLink(null)}>
              {t("verifyLinkClose")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.open(verifyLink?.publicUrl, "_blank", "noopener")}>
              <ExternalLink size={12} /> {t("verifyLinkOpen")}
            </Button>
            <Button variant="primary" size="sm" onClick={() => void copyVerifyLink()}>
              {linkCopied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
              {linkCopied ? t("verifyLinkCopied") : t("verifyLinkCopy")}
            </Button>
          </div>
        </div>
      </Dialog>

      {/* void dialog */}
      <Dialog open={showVoid} onClose={() => setShowVoid(false)} title={t("voidTitle")} size="sm">
        <div className="space-y-3">
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-ink-3">
            {t("voidReason")}
          </label>
          <textarea
            rows={3}
            value={voidReason}
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder={t("reasonPlaceholder")}
            className="w-full resize-none rounded-xs border border-line bg-surface p-2 text-[12px] text-ink focus:border-accent focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowVoid(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button variant="danger" size="sm" onClick={() => void doVoid()} loading={busy} disabled={busy || !voidReason.trim()}>
              {t("voidEnvelope")}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
