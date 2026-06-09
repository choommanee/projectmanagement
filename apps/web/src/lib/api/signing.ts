// Tier-1 e-signature (envelope-based) API client.
// Talks to the Next.js proxy under /api which forwards tenant + JWT + client IP
// to document-svc (:8084). All backend shapes are snake_case; we normalize to
// camelCase for the React layer while keeping request bodies snake_case.

// ─── domain types ───────────────────────────────────────────────────────────

export type EnvelopeStatus =
  | "draft" | "sent" | "completed" | "declined" | "voided" | "expired";
export type SigningOrder = "sequential" | "parallel";
export type SignerStatus = "pending" | "signed" | "declined";
export type RoutingStatus = "waiting" | "active" | "completed" | "declined";
export type AuthMethod = "session" | "email_otp" | "sso" | "typed_name";
export type SignEventType =
  | "viewed" | "consented" | "signed" | "declined" | "sent" | "reminder" | "completed" | "voided";

export interface Signer {
  id: string;                 // signer-row id (used in routes)
  signerId: string;           // user uuid
  signerName: string;
  signerEmail: string;
  orderIndex: number;
  status: SignerStatus;
  routingStatus: RoutingStatus;
  authMethod: AuthMethod;
  typedName?: string;
  hasSignatureImage: boolean;
  consent: boolean;
  requestedAt?: string;
  viewedAt?: string;
  signedAt?: string;
  declinedAt?: string;
  declineReason?: string;
  contentHash?: string;
  prevHash?: string;
  chainedHash?: string;
}

export interface Envelope {
  id: string;
  tenantId: string;
  documentId: string;
  versionId?: string;
  title: string;
  status: EnvelopeStatus;
  signingOrder: SigningOrder;
  createdBy?: string;
  createdAt: string;
  sentAt?: string;
  completedAt?: string;
  voidedAt?: string;
  voidReason?: string;
  expiresAt?: string;
  signers: Signer[];
}

export interface SignEvent {
  id: string;
  envelopeId: string;
  signerId?: string;
  eventType: SignEventType;
  actorId?: string;
  ipAddress?: string;
  userAgent?: string;
  geo?: string;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

export interface VerifyLink {
  signerId: string;
  orderIndex: number;
  contentMatches: boolean;
  chainMatches: boolean;
  /** Ed25519 record-signature check; undefined for legacy pre-hardening rows. */
  recordSigValid?: boolean;
  [k: string]: unknown;
}

/** Audit-event hash-chain status reported by GET /verify. */
export type EventChainStatus = "valid" | "invalid" | "legacy" | "empty";

export interface VerifyResult {
  envelopeId: string;
  valid: boolean;
  reason?: string;
  links: VerifyLink[];
  eventChain?: EventChainStatus;
}

// ─── input types ────────────────────────────────────────────────────────────

export interface NewSignerInput {
  signer_id: string;
  name?: string;
  email?: string;
  auth_method?: AuthMethod;
}

export interface CreateEnvelopeInput {
  title?: string;
  signing_order?: SigningOrder;
  expires_at?: string;
  signers: NewSignerInput[];
}

export interface SignInput {
  consent: boolean;
  typed_name?: string;
  signature_image_b64?: string;
  auth_method?: AuthMethod;
  /** Required when the signer row's auth_method is email_otp (step-up). */
  otp_code?: string;
}

/** Response of POST .../otp/request (email-OTP step-up challenge). */
export interface OtpChallenge {
  challengeId: string;
  expiresAt?: string;
  /** Populated only when document-svc runs with OTP_DEV_EXPOSE=true. */
  devCode?: string;
}

// ─── snake/camel normalization helpers ──────────────────────────────────────

const g = (r: Record<string, unknown>, k: string) =>
  r[k] ?? r[k[0].toUpperCase() + k.slice(1)];

const s = (r: Record<string, unknown>, snake: string, camel: string): unknown => {
  const goKey = camel
    .replace(/^(.)/, (c) => c.toUpperCase())
    .replace(/Id$/, "ID")
    .replace(/Id([A-Z])/, "ID$1");
  return r[snake] ?? r[camel] ?? r[goKey] ?? r[camel[0].toUpperCase() + camel.slice(1)];
};

const str = (v: unknown): string => (v == null ? "" : String(v));
const optStr = (v: unknown): string | undefined =>
  v == null || v === "" ? undefined : String(v);

function normSigner(r: Record<string, unknown>): Signer {
  return {
    id: str(g(r, "id")),
    signerId: str(s(r, "signer_id", "signerId")),
    signerName: str(s(r, "signer_name", "signerName")),
    signerEmail: str(s(r, "signer_email", "signerEmail")),
    orderIndex: Number(s(r, "order_index", "orderIndex") ?? 0),
    status: (g(r, "status") ?? "pending") as SignerStatus,
    routingStatus: (s(r, "routing_status", "routingStatus") ?? "waiting") as RoutingStatus,
    authMethod: (s(r, "auth_method", "authMethod") ?? "session") as AuthMethod,
    typedName: optStr(s(r, "typed_name", "typedName")),
    hasSignatureImage: Boolean(s(r, "has_signature_image", "hasSignatureImage")),
    consent: Boolean(g(r, "consent")),
    requestedAt: optStr(s(r, "requested_at", "requestedAt")),
    viewedAt: optStr(s(r, "viewed_at", "viewedAt")),
    signedAt: optStr(s(r, "signed_at", "signedAt")),
    declinedAt: optStr(s(r, "declined_at", "declinedAt")),
    declineReason: optStr(s(r, "decline_reason", "declineReason")),
    contentHash: optStr(s(r, "content_hash", "contentHash")),
    prevHash: optStr(s(r, "prev_hash", "prevHash")),
    chainedHash: optStr(s(r, "chained_hash", "chainedHash")),
  };
}

function normEnvelope(r: Record<string, unknown>): Envelope {
  const rawSigners = (g(r, "signers") ?? []) as Record<string, unknown>[] | null;
  return {
    id: str(g(r, "id")),
    tenantId: str(s(r, "tenant_id", "tenantId")),
    documentId: str(s(r, "document_id", "documentId")),
    versionId: optStr(s(r, "version_id", "versionId")),
    title: str(g(r, "title")),
    status: (g(r, "status") ?? "draft") as EnvelopeStatus,
    signingOrder: (s(r, "signing_order", "signingOrder") ?? "sequential") as SigningOrder,
    createdBy: optStr(s(r, "created_by", "createdBy")),
    createdAt: str(s(r, "created_at", "createdAt")),
    sentAt: optStr(s(r, "sent_at", "sentAt")),
    completedAt: optStr(s(r, "completed_at", "completedAt")),
    voidedAt: optStr(s(r, "voided_at", "voidedAt")),
    voidReason: optStr(s(r, "void_reason", "voidReason")),
    expiresAt: optStr(s(r, "expires_at", "expiresAt")),
    signers: (rawSigners ?? [])
      .map(normSigner)
      .sort((a, b) => a.orderIndex - b.orderIndex),
  };
}

function normEvent(r: Record<string, unknown>): SignEvent {
  return {
    id: str(g(r, "id")),
    envelopeId: str(s(r, "envelope_id", "envelopeId")),
    signerId: optStr(s(r, "signer_id", "signerId")),
    eventType: (s(r, "event_type", "eventType") ?? "viewed") as SignEventType,
    actorId: optStr(s(r, "actor_id", "actorId")),
    ipAddress: optStr(s(r, "ip_address", "ipAddress")),
    userAgent: optStr(s(r, "user_agent", "userAgent")),
    geo: optStr(g(r, "geo")),
    metadata: (g(r, "metadata") ?? null) as Record<string, unknown> | null,
    createdAt: str(s(r, "created_at", "createdAt")),
  };
}

function normVerify(r: Record<string, unknown>): VerifyResult {
  const links = (g(r, "links") ?? []) as Record<string, unknown>[] | null;
  return {
    envelopeId: str(s(r, "envelope_id", "envelopeId")),
    valid: Boolean(g(r, "valid")),
    reason: optStr(g(r, "reason")),
    eventChain: optStr(s(r, "event_chain", "eventChain")) as EventChainStatus | undefined,
    links: (links ?? []).map((l) => {
      const rsv = s(l, "record_sig_valid", "recordSigValid");
      return {
        ...l,
        signerId: str(s(l, "signer_id", "signerId")),
        orderIndex: Number(s(l, "order_index", "orderIndex") ?? 0),
        contentMatches: Boolean(s(l, "content_matches", "contentMatches")),
        chainMatches: Boolean(s(l, "chain_matches", "chainMatches")),
        recordSigValid: rsv == null ? undefined : Boolean(rsv),
      };
    }) as VerifyLink[],
  };
}

async function jsonOrThrow(r: Response): Promise<Record<string, unknown>> {
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `HTTP ${r.status}`);
  }
  return (await r.json()) as Record<string, unknown>;
}

// ─── document-scoped ────────────────────────────────────────────────────────

export async function listEnvelopes(documentId: string): Promise<Envelope[]> {
  const r = await fetch(`/api/documents/${documentId}/sign-envelopes`, { cache: "no-store" });
  const body = await jsonOrThrow(r);
  const arr = (body.items ?? body) as Record<string, unknown>[] | null;
  return (arr ?? []).map(normEnvelope);
}

export async function createEnvelope(
  documentId: string,
  input: CreateEnvelopeInput,
): Promise<Envelope> {
  const r = await fetch(`/api/documents/${documentId}/sign-envelopes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return normEnvelope(await jsonOrThrow(r));
}

export async function listDocumentAudit(documentId: string): Promise<SignEvent[]> {
  const r = await fetch(`/api/documents/${documentId}/sign-audit`, { cache: "no-store" });
  const body = await jsonOrThrow(r);
  const arr = (body.items ?? body) as Record<string, unknown>[] | null;
  return (arr ?? []).map(normEvent);
}

// ─── envelope-scoped ────────────────────────────────────────────────────────

export async function getEnvelope(envelopeId: string): Promise<Envelope> {
  const r = await fetch(`/api/sign-envelopes/${envelopeId}`, { cache: "no-store" });
  return normEnvelope(await jsonOrThrow(r));
}

export async function sendEnvelope(envelopeId: string): Promise<Envelope> {
  const r = await fetch(`/api/sign-envelopes/${envelopeId}/send`, { method: "POST" });
  return normEnvelope(await jsonOrThrow(r));
}

export async function voidEnvelope(envelopeId: string, reason: string): Promise<Envelope> {
  const r = await fetch(`/api/sign-envelopes/${envelopeId}/void`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  return normEnvelope(await jsonOrThrow(r));
}

export async function viewSigner(envelopeId: string, signerRowId: string): Promise<Signer> {
  const r = await fetch(`/api/sign-envelopes/${envelopeId}/signers/${signerRowId}/view`, {
    method: "POST",
  });
  return normSigner(await jsonOrThrow(r));
}

export interface SignResult {
  signer: Signer;
  envelope: Envelope;
  completed: boolean;
}

export async function signEnvelope(
  envelopeId: string,
  signerRowId: string,
  input: SignInput,
): Promise<SignResult> {
  const r = await fetch(`/api/sign-envelopes/${envelopeId}/signers/${signerRowId}/sign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await jsonOrThrow(r);
  return {
    signer: normSigner((g(body, "signer") ?? {}) as Record<string, unknown>),
    envelope: normEnvelope((g(body, "envelope") ?? {}) as Record<string, unknown>),
    completed: Boolean(g(body, "completed")),
  };
}

/**
 * Request an email-OTP step-up challenge for a signer row
 * (auth_method=email_otp). Backend errors: 403 (not your row / not otp
 * signer), 429 otp_rate_limited (max 3 requests / 5 min).
 */
export async function requestSignerOtp(
  envelopeId: string,
  signerRowId: string,
): Promise<OtpChallenge> {
  const r = await fetch(
    `/api/sign-envelopes/${envelopeId}/signers/${signerRowId}/otp/request`,
    { method: "POST" },
  );
  const body = await jsonOrThrow(r);
  return {
    challengeId: str(s(body, "challenge_id", "challengeId")),
    expiresAt: optStr(s(body, "expires_at", "expiresAt")),
    devCode: optStr(s(body, "dev_code", "devCode")),
  };
}

export async function declineSigner(
  envelopeId: string,
  signerRowId: string,
  reason: string,
): Promise<Signer> {
  const r = await fetch(`/api/sign-envelopes/${envelopeId}/signers/${signerRowId}/decline`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  return normSigner(await jsonOrThrow(r));
}

export async function verifyEnvelope(envelopeId: string): Promise<VerifyResult> {
  const r = await fetch(`/api/sign-envelopes/${envelopeId}/verify`, { cache: "no-store" });
  return normVerify(await jsonOrThrow(r));
}

export async function listEnvelopeAudit(envelopeId: string): Promise<SignEvent[]> {
  const r = await fetch(`/api/sign-envelopes/${envelopeId}/audit`, { cache: "no-store" });
  const body = await jsonOrThrow(r);
  const arr = (body.items ?? body) as Record<string, unknown>[] | null;
  return (arr ?? []).map(normEvent);
}

// ─── binary (certificate PDF) ───────────────────────────────────────────────

/** Fetch the Certificate of Completion PDF and trigger a browser download. */
export async function downloadEnvelopeCertificate(
  envelopeId: string,
  filename = `certificate-${envelopeId}.pdf`,
): Promise<void> {
  const r = await fetch(`/api/sign-envelopes/${envelopeId}/certificate`, { cache: "no-store" });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `HTTP ${r.status}`);
  }
  const blob = await r.blob();
  triggerDownload(blob, filename);
}

export async function downloadDocumentCertificate(
  documentId: string,
  filename = `certificate-${documentId}.pdf`,
): Promise<void> {
  const r = await fetch(`/api/documents/${documentId}/sign-certificate`, { cache: "no-store" });
  if (!r.ok) {
    const e = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `HTTP ${r.status}`);
  }
  const blob = await r.blob();
  triggerDownload(blob, filename);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── public verification links (Team F) ─────────────────────────────────────

export interface VerifyLinkRow {
  id: string;
  envelopeId: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  accessCount: number;
  lastAccessedAt?: string;
}

export interface CreatedVerifyLink {
  link: VerifyLinkRow;
  /** Raw share token — returned exactly once, never retrievable again. */
  token: string;
  /** Full public URL composed by the backend (PUBLIC_VERIFY_BASE_URL). */
  publicUrl: string;
}

function normVerifyLinkRow(r: Record<string, unknown>): VerifyLinkRow {
  return {
    id: str(g(r, "id")),
    envelopeId: str(s(r, "envelope_id", "envelopeId")),
    createdAt: str(s(r, "created_at", "createdAt")),
    expiresAt: optStr(s(r, "expires_at", "expiresAt")),
    revokedAt: optStr(s(r, "revoked_at", "revokedAt")),
    accessCount: Number(s(r, "access_count", "accessCount") ?? 0),
    lastAccessedAt: optStr(s(r, "last_accessed_at", "lastAccessedAt")),
  };
}

/** Mint a public verification link for a COMPLETED envelope (Cedar-gated). */
export async function createVerifyLink(
  envelopeId: string,
  expiresAt?: string,
): Promise<CreatedVerifyLink> {
  const r = await fetch(`/api/sign-envelopes/${envelopeId}/verify-links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(expiresAt ? { expires_at: expiresAt } : {}),
  });
  const body = await jsonOrThrow(r);
  return {
    link: normVerifyLinkRow((g(body, "link") ?? {}) as Record<string, unknown>),
    token: str(g(body, "token")),
    publicUrl: str(s(body, "public_url", "publicUrl")),
  };
}

/** List existing verification links (hashes are never exposed). */
export async function listVerifyLinks(envelopeId: string): Promise<VerifyLinkRow[]> {
  const r = await fetch(`/api/sign-envelopes/${envelopeId}/verify-links`, { cache: "no-store" });
  const body = await jsonOrThrow(r);
  const arr = (body.items ?? body) as Record<string, unknown>[] | null;
  return (arr ?? []).map(normVerifyLinkRow);
}

/** Revoke a verification link — its public URL 404s from then on. */
export async function revokeVerifyLink(envelopeId: string, linkId: string): Promise<VerifyLinkRow> {
  const r = await fetch(`/api/sign-envelopes/${envelopeId}/verify-links/${linkId}`, {
    method: "DELETE",
  });
  return normVerifyLinkRow(await jsonOrThrow(r));
}
