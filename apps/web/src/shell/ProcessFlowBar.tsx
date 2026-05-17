export function ProcessFlowBar({ stages, current }: { stages: { id: string; label: string }[]; current: string }) {
  const idx = Math.max(0, stages.findIndex((s) => s.id === current));
  return (
    <ol className="flex items-stretch overflow-hidden rounded-md border border-line text-sm" aria-label="Process stages">
      {stages.map((s, i) => {
        const state = i < idx ? "done" : i === idx ? "current" : "pending";
        return (
          <li key={s.id} className={`flex flex-1 items-center justify-center px-3 py-1
            ${state === "done"    ? "bg-surface-2 text-ink-2" : ""}
            ${state === "current" ? "bg-accent text-white font-medium" : ""}
            ${state === "pending" ? "bg-paper text-ink-3" : ""}
            ${i > 0 ? "border-l border-line" : ""}`}>
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}
