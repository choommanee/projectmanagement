"use client";

import { useCallback, useState } from "react";
import { Play, X } from "lucide-react";
import { Button } from "@pmplatform/ui-kit";
import {
  listWorkflows,
  startInstance,
  type WorkflowDef,
  type WorkflowInstance,
} from "@/lib/api/workflows";

// ─── Props ────────────────────────────────────────────────────────────────────

interface RunWorkflowButtonProps {
  /** Pre-filled context injected as workflow input */
  context?: Record<string, string>;
  /** Label override (default: "Run Workflow") */
  label?: string;
}

// ─── Modal Step types ─────────────────────────────────────────────────────────

type ModalStep = "select" | "fill";

// ─── RunWorkflowButton ────────────────────────────────────────────────────────

export function RunWorkflowButton({ context, label }: RunWorkflowButtonProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<ModalStep>("select");

  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [loadingWorkflows, setLoadingWorkflows] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowDef | null>(null);

  const [extraInput, setExtraInput] = useState("{}");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [startedInstance, setStartedInstance] = useState<WorkflowInstance | null>(null);

  const openModal = useCallback(async () => {
    setOpen(true);
    setStep("select");
    setSelectedWorkflow(null);
    setExtraInput("{}");
    setStartError(null);
    setStartedInstance(null);
    setLoadingWorkflows(true);
    try {
      const { items } = await listWorkflows({ status: "published", limit: 100 });
      setWorkflows(items);
    } catch {
      setWorkflows([]);
    } finally {
      setLoadingWorkflows(false);
    }
  }, []);

  function handleSelectWorkflow(wf: WorkflowDef) {
    setSelectedWorkflow(wf);
    setStep("fill");
    setStartError(null);
  }

  async function handleStart() {
    if (!selectedWorkflow) return;
    setStarting(true);
    setStartError(null);

    let extra: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(extraInput.trim() || "{}");
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        extra = parsed as Record<string, unknown>;
      }
    } catch {
      setStartError("Additional input is not valid JSON.");
      setStarting(false);
      return;
    }

    const mergedInput: Record<string, unknown> = {
      ...(context ?? {}),
      ...extra,
    };

    try {
      const instance = await startInstance(selectedWorkflow.id, { input: mergedInput });
      setStartedInstance(instance);
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  function closeModal() {
    setOpen(false);
    setStep("select");
    setSelectedWorkflow(null);
    setStartedInstance(null);
    setStartError(null);
    setExtraInput("{}");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void openModal()}
        className="flex items-center gap-1.5 rounded border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent"
      >
        <Play size={12} />
        {label ?? "Run Workflow"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-md rounded-lg border border-line bg-paper shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">
                {step === "select" ? "Select Workflow" : selectedWorkflow?.name ?? "Run Workflow"}
              </h2>
              <button
                type="button"
                title="Close"
                aria-label="Close"
                onClick={closeModal}
                className="text-ink-3 hover:text-ink"
              >
                <X size={15} />
              </button>
            </div>

            {/* Success state */}
            {startedInstance ? (
              <div className="p-6 text-center">
                <div className="mb-3 text-sm font-semibold text-success">Workflow started</div>
                <p className="mb-4 text-xs text-ink-3">
                  Instance{" "}
                  <span className="font-mono text-ink-2">{startedInstance.id.slice(0, 8)}…</span>{" "}
                  is running.
                </p>
                <div className="flex justify-center gap-2">
                  <a
                    href={`/pm/workflows/${startedInstance.definitionId}`}
                    className="rounded border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent"
                    onClick={closeModal}
                  >
                    View Workflow →
                  </a>
                  <Button variant="ghost" size="sm" onClick={closeModal}>Close</Button>
                </div>
              </div>
            ) : step === "select" ? (
              /* Step 1: Select workflow */
              <div className="p-4">
                {loadingWorkflows ? (
                  <div className="flex items-center justify-center py-8 text-sm text-ink-3">
                    Loading workflows…
                  </div>
                ) : workflows.length === 0 ? (
                  <div className="py-8 text-center text-sm text-ink-3">
                    No published workflows found.
                  </div>
                ) : (
                  <div className="max-h-72 space-y-1 overflow-auto">
                    {workflows.map((wf) => (
                      <button
                        type="button"
                        key={wf.id}
                        onClick={() => handleSelectWorkflow(wf)}
                        className="flex w-full flex-col gap-0.5 rounded-xs px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
                      >
                        <span className="text-[13px] font-semibold text-ink">{wf.name}</span>
                        {wf.description && (
                          <span className="truncate text-[11px] text-ink-3">{wf.description}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Step 2: Fill input */
              <div className="space-y-3 p-4">
                {/* Pre-filled context */}
                {context && Object.keys(context).length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
                      Context (pre-filled)
                    </p>
                    <div className="rounded-xs border border-line bg-surface-2 p-2">
                      {Object.entries(context).map(([k, v]) => (
                        <div key={k} className="flex items-center gap-2 py-0.5">
                          <span className="font-mono text-[11px] text-ink-3">{k}:</span>
                          <span className="truncate font-mono text-[11px] text-ink-2">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Extra JSON input */}
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
                    Additional Input (JSON)
                  </label>
                  <textarea
                    value={extraInput}
                    onChange={(e) => {
                      setExtraInput(e.target.value);
                      setStartError(null);
                    }}
                    rows={4}
                    spellCheck={false}
                    className="w-full resize-none rounded-xs border border-line bg-surface px-3 py-2 font-mono text-[12px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
                  />
                </div>

                {startError && (
                  <p className="text-xs text-danger">{startError}</p>
                )}
              </div>
            )}

            {/* Footer (only in fill step, before success) */}
            {step === "fill" && !startedInstance && (
              <div className="flex items-center justify-between border-t border-line px-4 py-3">
                <button
                  type="button"
                  onClick={() => { setStep("select"); setStartError(null); }}
                  className="text-[11px] text-ink-3 hover:text-ink"
                >
                  ← Back
                </button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void handleStart()}
                  disabled={starting}
                >
                  {starting ? "Starting…" : "Start Workflow"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
