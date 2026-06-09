"use client";

import { useTranslations } from "next-intl";
import {
  CheckCircle2, Eye, FileSignature, Mail, Send, ShieldCheck, Slash, XCircle,
  type LucideIcon,
} from "lucide-react";
import type { SignEvent, SignEventType } from "@/lib/api/signing";
import { absDate } from "./signingUi";

const ICONS: Record<SignEventType, LucideIcon> = {
  viewed: Eye,
  consented: ShieldCheck,
  signed: FileSignature,
  declined: XCircle,
  sent: Send,
  reminder: Mail,
  completed: CheckCircle2,
  voided: Slash,
};

const TONE: Record<SignEventType, string> = {
  viewed: "text-info",
  consented: "text-accent",
  signed: "text-success",
  declined: "text-danger",
  sent: "text-info",
  reminder: "text-warning",
  completed: "text-success",
  voided: "text-warning",
};

export function AuditTrail({ events }: { events: SignEvent[] }) {
  const t = useTranslations("signing");

  if (events.length === 0) {
    return <p className="font-mono text-[11px] text-ink-3">{t("noAudit")}</p>;
  }

  return (
    <ol className="space-y-0">
      {events.map((e, i) => {
        const Icon = ICONS[e.eventType] ?? Eye;
        return (
          <li key={e.id} className="relative flex gap-3 pl-1">
            {/* rail */}
            <div className="flex flex-col items-center">
              <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface ${TONE[e.eventType]}`}>
                <Icon size={12} />
              </span>
              {i < events.length - 1 && <span className="w-px flex-1 bg-line" />}
            </div>
            {/* body */}
            <div className="flex-1 pb-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-semibold text-ink">
                  {t(`eventType.${e.eventType}`)}
                </span>
                <span className="font-mono text-[10px] text-ink-3">{absDate(e.createdAt)}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-ink-3">
                {e.actorId && <span>{t("actor")}: {e.actorId.slice(-8)}</span>}
                {e.ipAddress && <span>{t("ip")}: {e.ipAddress}</span>}
                {e.userAgent && <span className="max-w-[260px] truncate" title={e.userAgent}>{t("device")}: {e.userAgent}</span>}
                {e.geo && <span>{e.geo}</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
