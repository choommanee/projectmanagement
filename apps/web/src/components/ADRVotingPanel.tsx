"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { Document, DocumentStatus } from "@/lib/api/documents";

// ─── Types ────────────────────────────────────────────────────────────────────

type ADRVote = {
  userId: string;
  vote: "accepted" | "rejected" | "abstain";
  votedAt: string; // ISO
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface ADRVotingPanelProps {
  doc: Document;
  onMetadataChange: (metadata: Record<string, unknown>) => void;
  onStatusChange: (status: DocumentStatus) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive a short display label from a userId for the voter chip. */
function voterLabel(userId: string): string {
  return userId.slice(-4).toUpperCase();
}

// ─── ADRVotingPanel ───────────────────────────────────────────────────────────

export function ADRVotingPanel({
  doc,
  onMetadataChange,
  onStatusChange,
}: ADRVotingPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();
  const currentUserId = user?.id ?? "anonymous";

  const votes = (doc.metadata?.votes as ADRVote[] | undefined) ?? [];
  const myVote = votes.find((v) => v.userId === currentUserId);

  const tally = {
    accepted: votes.filter((v) => v.vote === "accepted").length,
    rejected: votes.filter((v) => v.vote === "rejected").length,
    abstain: votes.filter((v) => v.vote === "abstain").length,
  };

  const total = tally.accepted + tally.rejected + tally.abstain;
  const majority = total > 0 && tally.accepted > total / 2;

  function castVote(vote: ADRVote["vote"]) {
    const newVote: ADRVote = {
      userId: currentUserId,
      vote,
      votedAt: new Date().toISOString(),
    };
    const updatedVotes = [
      ...votes.filter((v) => v.userId !== currentUserId),
      newVote,
    ];
    onMetadataChange({ ...doc.metadata, votes: updatedVotes });
  }

  return (
    <div className="border-t border-line bg-paper">
      {/* ── Header / toggle ─────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-[12px] font-medium text-ink-2 hover:bg-surface-2"
      >
        <span className="flex items-center gap-2">
          <span className="text-ink-3">{collapsed ? "▸" : "▾"}</span>
          Team Decision Votes
        </span>
        <span className="font-mono text-[11px] text-ink-3">
          {tally.accepted}A · {tally.rejected}R · {tally.abstain}Ab
        </span>
      </button>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      {!collapsed && (
        <div className="space-y-3 border-t border-line/60 px-4 py-3">
          {/* Vote buttons */}
          <div className="flex gap-2">
            {(["accepted", "rejected", "abstain"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => castVote(v)}
                className={`flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  myVote?.vote === v
                    ? v === "accepted"
                      ? "border-success bg-success/10 text-success"
                      : v === "rejected"
                        ? "border-danger bg-danger/10 text-danger"
                        : "border-ink bg-ink text-paper"
                    : "border-line bg-surface text-ink-2 hover:border-line-strong"
                }`}
              >
                {v === "accepted"
                  ? "✓ Accept"
                  : v === "rejected"
                    ? "✗ Reject"
                    : "– Abstain"}
              </button>
            ))}
          </div>

          {/* Tally row */}
          <div className="font-mono text-[11px] text-ink-3">
            <span className="text-success">{tally.accepted} Accepted</span>
            {" · "}
            <span className="text-danger">{tally.rejected} Rejected</span>
            {" · "}
            <span>{tally.abstain} Abstain</span>
          </div>

          {/* Voter chips */}
          {votes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {votes.map((v) => (
                <span
                  key={v.userId}
                  title={`${v.userId} · ${v.vote} · ${new Date(v.votedAt).toLocaleString()}`}
                  className={`inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5 font-mono text-[10px] ${
                    v.vote === "accepted"
                      ? "border-success/40 bg-success/5 text-success"
                      : v.vote === "rejected"
                        ? "border-danger/40 bg-danger/5 text-danger"
                        : "border-line bg-surface-2 text-ink-3"
                  }`}
                >
                  {voterLabel(v.userId)}
                  <span className="text-[9px] opacity-60">
                    {v.vote === "accepted" ? "A" : v.vote === "rejected" ? "R" : "Ab"}
                  </span>
                </span>
              ))}
            </div>
          )}

          {/* Majority banner */}
          {majority && doc.status !== "approved" && (
            <div className="flex items-center justify-between rounded-xs border border-success/30 bg-success/5 px-3 py-2 text-[12px]">
              <span className="text-success">
                Majority accepted — ready to finalize
              </span>
              <button
                type="button"
                onClick={() => onStatusChange("approved")}
                className="rounded-xs bg-success px-2 py-0.5 text-[11px] font-medium text-surface hover:bg-success/80"
              >
                Mark as Accepted
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
