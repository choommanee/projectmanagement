"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, MailCheck, PenLine, ShieldCheck } from "lucide-react";
import { Button } from "@pmplatform/ui-kit";
import {
  signEnvelope,
  declineSigner,
  viewSigner,
  requestSignerOtp,
  type Envelope,
  type Signer,
} from "@/lib/api/signing";
import { SignatureCapture, type SignatureValue } from "./SignatureCapture";

interface Props {
  envelope: Envelope;
  signer: Signer;          // the current user's active signer row
  defaultName?: string;
  onSigned: (env: Envelope) => void;
  onDeclined: (env: Envelope) => void;
}

/** Strip the "data:image/png;base64," prefix → bare base64 for the backend. */
function toB64(dataUrl: string | null): string | undefined {
  if (!dataUrl) return undefined;
  const i = dataUrl.indexOf(",");
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

export function SignNowCard({ envelope, signer, defaultName, onSigned, onDeclined }: Props) {
  const t = useTranslations("signing");

  const [sig, setSig] = useState<SignatureValue>({ typedName: defaultName ?? "", imageDataUrl: null });
  const [consent, setConsent] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Email-OTP step-up (auth_method=email_otp): the signer must request a
  // 6-digit code (emailed) and include it in the sign call.
  const needsOtp = signer.authMethod === "email_otp";
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpDevCode, setOtpDevCode] = useState<string | undefined>(undefined);
  const [otpBusy, setOtpBusy] = useState(false);

  /** Map backend OTP error tags to localized messages. */
  function otpErrorMessage(msg: string): string {
    if (msg.includes("otp_required")) return t("otpRequired");
    if (msg.includes("otp_invalid")) return t("otpInvalid");
    if (msg.includes("otp_expired")) return t("otpExpired");
    if (msg.includes("otp_rate_limited")) return t("otpRateLimited");
    return msg;
  }

  async function doSendOtp() {
    setOtpBusy(true);
    setError(null);
    try {
      const ch = await requestSignerOtp(envelope.id, signer.id);
      setOtpSent(true);
      setOtpDevCode(ch.devCode);
    } catch (e) {
      setError(otpErrorMessage((e as Error).message));
    } finally {
      setOtpBusy(false);
    }
  }

  // Record a "viewed" event the first time the signer opens this card.
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    if (signer.viewedAt) { viewed.current = true; return; }
    viewed.current = true;
    void viewSigner(envelope.id, signer.id).catch(() => { /* non-blocking */ });
  }, [envelope.id, signer.id, signer.viewedAt]);

  const hasSignature = Boolean(sig.typedName.trim() || sig.imageDataUrl);

  async function doSign() {
    // Consent gate — backend rejects without consent:true, enforce client-side too.
    if (!consent) { setError(t("consentRequired")); return; }
    if (!hasSignature) return;
    if (needsOtp && !otpCode.trim()) { setError(t("otpRequired")); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await signEnvelope(envelope.id, signer.id, {
        consent: true,
        typed_name: sig.typedName.trim() || undefined,
        signature_image_b64: toB64(sig.imageDataUrl),
        auth_method: signer.authMethod,
        otp_code: needsOtp ? otpCode.trim() : undefined,
      });
      onSigned(res.envelope);
    } catch (e) {
      setError(otpErrorMessage((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  async function doDecline() {
    if (!declineReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await declineSigner(envelope.id, signer.id, declineReason.trim());
      // refetch via parent — pass envelope id back; parent reloads
      onDeclined(envelope);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xs border border-accent/40 bg-accent-soft/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <PenLine size={14} className="text-accent" />
        <span className="text-[13px] font-semibold text-ink">{t("yourTurn")}</span>
      </div>
      <p className="mb-3 text-[12px] text-ink-2">{t("reviewDocument")}</p>

      {!declining ? (
        <>
          <SignatureCapture defaultName={defaultName} onChange={setSig} />

          {/* Email-OTP step-up — REQUIRED for email_otp signers */}
          {needsOtp && (
            <div className="mt-3 rounded-xs border border-line bg-surface p-2.5">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck size={13} className="text-accent" />
                <span className="text-[11px] font-semibold text-ink">{t("otpTitle")}</span>
              </div>
              <p className="mb-2 text-[11px] leading-relaxed text-ink-2">{t("otpHint")}</p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void doSendOtp()} loading={otpBusy} disabled={otpBusy || busy}>
                  <MailCheck size={12} /> {otpSent ? t("otpResendCode") : t("otpSendCode")}
                </Button>
                <input
                  value={otpCode}
                  onChange={(e) => { setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setError(null); }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder={t("otpCodePlaceholder")}
                  aria-label={t("otpTitle")}
                  className="h-8 w-32 rounded-xs border border-line bg-surface px-2 text-center font-mono text-[14px] tracking-[0.3em] text-ink focus:border-accent focus:outline-none"
                />
              </div>
              {otpSent && (
                <p className="mt-2 font-mono text-[10px] text-ink-3">
                  {t("otpCodeSent")}
                  {otpDevCode ? ` · dev_code=${otpDevCode}` : ""}
                </p>
              )}
            </div>
          )}

          {/* Consent gate — REQUIRED */}
          <label className="mt-3 flex items-start gap-2 rounded-xs border border-line bg-surface p-2.5">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => { setConsent(e.target.checked); if (e.target.checked) setError(null); }}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-accent,#2563eb)]"
            />
            <span className="text-[11px] leading-relaxed text-ink-2">{t("consentLabel")}</span>
          </label>

          {error && (
            <p className="mt-2 font-mono text-[11px] text-danger">{error}</p>
          )}

          <div className="mt-3 flex items-center justify-between gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDeclining(true)} disabled={busy}>
              {t("decline")}
            </Button>
            <Button
              variant="primary"
              onClick={() => void doSign()}
              loading={busy}
              disabled={busy || !consent || !hasSignature || (needsOtp && otpCode.trim().length !== 6)}
            >
              <CheckCircle2 size={13} /> {t("signNow")}
            </Button>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <label className="block text-[10px] font-semibold uppercase tracking-widest text-ink-3">
            {t("declineReason")}
          </label>
          <textarea
            rows={3}
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
            placeholder={t("reasonPlaceholder")}
            className="w-full resize-none rounded-xs border border-line bg-surface p-2 text-[12px] text-ink focus:border-accent focus:outline-none"
          />
          {error && <p className="font-mono text-[11px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDeclining(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button variant="danger" size="sm" onClick={() => void doDecline()} loading={busy} disabled={busy || !declineReason.trim()}>
              {t("decline")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
