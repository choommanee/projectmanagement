import { getTranslations } from "next-intl/server";
import {
  ShieldCheck, ShieldAlert, ShieldQuestion, FileCheck2, CheckCircle2, XCircle, Clock,
} from "lucide-react";

const SVC = process.env.DOCUMENT_URL ?? "http://localhost:8084";

// Safe public subset served by document-svc GET /public/verify/{token}
// (services/document-svc/internal/domain/publiclink.go PublicVerifyReport).
interface PublicSigner {
  display_name: string;
  email_masked?: string;
  status: "pending" | "signed" | "declined";
  signed_at?: string;
  auth_method: string;
}
interface PublicReport {
  envelope_short_id: string;
  document_title: string;
  status: string;
  signing_order: string;
  completed_at?: string;
  signers: PublicSigner[];
  checks: {
    record_chain_valid: boolean;
    event_chain: "valid" | "invalid" | "legacy" | "empty";
    record_signatures: "valid" | "invalid" | "absent";
    signed_signer_count: number;
  };
  valid: boolean;
  reason?: string;
  document_hash?: string;
  certificate_available: boolean;
  verified_at: string;
}

async function fetchReport(token: string): Promise<PublicReport | null> {
  if (!token || token.length > 128) return null;
  try {
    const r = await fetch(`${SVC}/public/verify/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.json()) as PublicReport;
  } catch {
    return null;
  }
}

function fmtDate(iso?: string, locale?: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat(locale === "th" ? "th-TH" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function CheckRow({ label, state }: { label: string; state: "pass" | "fail" | "neutral"; }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2 last:border-b-0">
      <span className="text-[12px] text-ink-2">{label}</span>
      {state === "pass" ? (
        <CheckCircle2 size={14} className="shrink-0 text-success" />
      ) : state === "fail" ? (
        <XCircle size={14} className="shrink-0 text-danger" />
      ) : (
        <Clock size={14} className="shrink-0 text-ink-3" />
      )}
    </div>
  );
}

export default async function PublicVerifyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations("publicVerify");
  const report = await fetchReport(token);

  // ── not found / revoked / expired (indistinguishable by design) ──────────
  if (!report) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-2 px-4">
        <div className="w-full max-w-md rounded-xs border border-line bg-surface p-8 text-center">
          <ShieldQuestion size={36} className="mx-auto mb-4 text-ink-3" />
          <h1 className="mb-2 text-[16px] font-semibold text-ink">{t("notFoundTitle")}</h1>
          <p className="text-[12px] leading-relaxed text-ink-3">{t("notFoundBody")}</p>
          <p className="mt-8 border-t border-line pt-4 font-mono text-[10px] uppercase tracking-widest text-ink-3">
            {t("footer")}
          </p>
        </div>
      </main>
    );
  }

  const c = report.checks;
  return (
    <main className="flex min-h-screen justify-center bg-surface-2 px-4 py-10">
      <div className="w-full max-w-2xl space-y-4">
        {/* verdict banner */}
        <section
          className={`rounded-xs border p-6 text-center ${
            report.valid ? "border-success/40 bg-success/5" : "border-danger/40 bg-danger/5"
          }`}
        >
          {report.valid ? (
            <ShieldCheck size={44} className="mx-auto mb-3 text-success" />
          ) : (
            <ShieldAlert size={44} className="mx-auto mb-3 text-danger" />
          )}
          <h1
            className={`font-mono text-[22px] font-bold uppercase tracking-[0.2em] ${
              report.valid ? "text-success" : "text-danger"
            }`}
          >
            {report.valid ? t("verdictValid") : t("verdictInvalid")}
          </h1>
          <p className="mt-2 text-[13px] text-ink-2">
            {report.valid ? t("verdictValidHint") : t("verdictInvalidHint")}
          </p>
          {!report.valid && report.reason && (
            <p className="mt-2 font-mono text-[11px] text-danger">{report.reason}</p>
          )}
        </section>

        {/* document meta */}
        <section className="rounded-xs border border-line bg-surface p-5">
          <h2 className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-widest text-ink-3">
            {t("documentSection")}
          </h2>
          <p className="text-[15px] font-semibold text-ink">{report.document_title || "—"}</p>
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt className="text-[11px] text-ink-3">{t("envelopeId")}</dt>
              <dd className="font-mono text-[11px] text-ink-2">{report.envelope_short_id}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[11px] text-ink-3">{t("statusLabel")}</dt>
              <dd className="font-mono text-[11px] uppercase text-ink-2">{report.status}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[11px] text-ink-3">{t("completedAt")}</dt>
              <dd className="font-mono text-[11px] text-ink-2">{fmtDate(report.completed_at)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[11px] text-ink-3">{t("verifiedAt")}</dt>
              <dd className="font-mono text-[11px] text-ink-2">{fmtDate(report.verified_at)}</dd>
            </div>
          </dl>
          {report.document_hash && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-1 text-[10px] uppercase tracking-widest text-ink-3">
                {t("documentHash")}
              </p>
              <p className="break-all font-mono text-[10px] leading-relaxed text-ink-2">
                {report.document_hash}
              </p>
            </div>
          )}
        </section>

        {/* signers */}
        <section className="rounded-xs border border-line bg-surface p-5">
          <h2 className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-widest text-ink-3">
            {t("signersSection")} ({report.signers.length})
          </h2>
          <ol className="space-y-3">
            {report.signers.map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <span
                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold ${
                    s.status === "signed"
                      ? "bg-success/10 text-success"
                      : s.status === "declined"
                        ? "bg-danger/10 text-danger"
                        : "bg-surface-2 text-ink-3"
                  }`}
                >
                  {s.status === "signed" ? <CheckCircle2 size={13} /> : s.status === "declined" ? <XCircle size={13} /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">
                    {s.display_name}
                    {s.email_masked && (
                      <span className="ml-2 font-mono text-[10px] text-ink-3">{s.email_masked}</span>
                    )}
                  </p>
                  <p className="font-mono text-[10px] text-ink-3">
                    {s.status === "signed"
                      ? `${t("signedAt")} ${fmtDate(s.signed_at)} · ${t("authMethod")}: ${s.auth_method}`
                      : s.status}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* integrity checks */}
        <section className="rounded-xs border border-line bg-surface p-5">
          <h2 className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-ink-3">
            {t("checksSection")}
          </h2>
          <CheckRow label={t("checkRecordChain")} state={c.record_chain_valid ? "pass" : "fail"} />
          <CheckRow
            label={`${t("checkEventChain")}${c.event_chain === "legacy" ? ` (${t("eventChainLegacy")})` : ""}`}
            state={c.event_chain === "invalid" ? "fail" : c.event_chain === "valid" ? "pass" : "neutral"}
          />
          <CheckRow
            label={`${t("checkRecordSignatures")}${c.record_signatures === "absent" ? ` (${t("recordSigAbsent")})` : ""}`}
            state={c.record_signatures === "invalid" ? "fail" : c.record_signatures === "valid" ? "pass" : "neutral"}
          />
          <p className="mt-3 font-mono text-[10px] text-ink-3">
            {t("signedCount", { count: c.signed_signer_count })}
          </p>
        </section>

        {/* certificate */}
        {report.certificate_available && (
          <a
            href={`/api/public/verify/${encodeURIComponent(token)}/certificate`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xs border border-line bg-surface px-4 py-3 text-[12px] font-medium text-ink transition-colors hover:border-accent hover:text-accent"
          >
            <FileCheck2 size={14} />
            {t("downloadCertificate")}
          </a>
        )}

        <footer className="pt-2 text-center">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-3">{t("footer")}</p>
        </footer>
      </div>
    </main>
  );
}
