import type { EnvelopeStatus, SignerStatus, RoutingStatus } from "@/lib/api/signing";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "signal";

export const ENVELOPE_TONE: Record<EnvelopeStatus, Tone> = {
  draft: "neutral",
  sent: "info",
  completed: "success",
  declined: "danger",
  voided: "warning",
  expired: "warning",
};

export const SIGNER_TONE: Record<SignerStatus, Tone> = {
  pending: "warning",
  signed: "success",
  declined: "danger",
};

export const ROUTING_TONE: Record<RoutingStatus, Tone> = {
  waiting: "neutral",
  active: "accent",
  completed: "success",
  declined: "danger",
};

export function relativeDate(iso?: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

export function absDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export function initials(name?: string, fallback?: string): string {
  const n = (name ?? "").trim();
  if (n) {
    const parts = n.split(/\s+/);
    return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || n.slice(0, 2).toUpperCase();
  }
  return (fallback ?? "??").slice(-2).toUpperCase();
}
