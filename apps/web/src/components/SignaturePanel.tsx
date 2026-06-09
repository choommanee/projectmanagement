"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@pmplatform/ui-kit";
import { useAuth } from "@/lib/auth/AuthProvider";
import { listEnvelopes, type Envelope } from "@/lib/api/signing";
import { CreateEnvelopeDialog } from "@/components/signing/CreateEnvelopeDialog";
import { EnvelopeCard } from "@/components/signing/EnvelopeCard";

interface SignaturePanelProps {
  documentId: string;
  /** Fired whenever an envelope changes (sign/decline/void/send) so the host
   *  page can refresh document state — e.g. status flips to approved when an
   *  envelope completes. */
  onEnvelopeChanged?: (envelope: Envelope) => void;
}

/**
 * Tier-1 e-signature panel (envelope-based). Primary signing UI for a document:
 * list envelopes, create+send new ones, sign / decline / void, verify integrity,
 * download the Certificate of Completion, and review the audit trail.
 */
export function SignaturePanel({ documentId, onEnvelopeChanged }: SignaturePanelProps) {
  const t = useTranslations("signing");
  const { user } = useAuth();

  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEnvelopes(await listEnvelopes(documentId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => { void load(); }, [load]);

  const replace = useCallback((env: Envelope) => {
    setEnvelopes((prev) => {
      const idx = prev.findIndex((e) => e.id === env.id);
      if (idx === -1) return [env, ...prev];
      const next = prev.slice();
      next[idx] = env;
      return next;
    });
    onEnvelopeChanged?.(env);
  }, [onEnvelopeChanged]);

  return (
    <div className="space-y-3">
      {/* header */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-ink-3">
          {t("signatures")}
        </span>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus size={12} /> {t("newEnvelope")}
        </Button>
      </div>

      {error && (
        <p className="rounded-xs border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">
          {error}
        </p>
      )}

      {loading ? (
        <p className="font-mono text-[11px] text-ink-3">{t("loading")}</p>
      ) : envelopes.length === 0 ? (
        <p className="rounded-xs border border-dashed border-line bg-surface-2 px-3 py-6 text-center font-mono text-[11px] text-ink-3">
          {t("noEnvelopes")}
        </p>
      ) : (
        <div className="space-y-2">
          {envelopes.map((env) => (
            <EnvelopeCard
              key={env.id}
              envelope={env}
              currentUserId={user?.id}
              currentUserName={user?.displayName}
              onChanged={replace}
            />
          ))}
        </div>
      )}

      <CreateEnvelopeDialog
        open={creating}
        documentId={documentId}
        onClose={() => setCreating(false)}
        onCreated={(env) => replace(env)}
      />
    </div>
  );
}
