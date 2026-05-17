export function ProcessFlowBar({ stages, current }: { stages: { id: string; label: string }[]; current: string }) {
  const idx = Math.max(0, stages.findIndex((s) => s.id === current));
  return (
    <ol className="flex items-stretch overflow-hidden rounded-md border border-border text-sm" aria-label="Process stages">
      {stages.map((s, i) => {
        const state = i < idx ? "done" : i === idx ? "current" : "pending";
        return (
          <li key={s.id} className={`flex flex-1 items-center justify-center px-3 py-1
            ${state === "done"    ? "bg-bgMuted text-fg" : ""}
            ${state === "current" ? "bg-primary text-white font-medium" : ""}
            ${state === "pending" ? "bg-bg text-fgMuted" : ""}
            ${i > 0 ? "border-l border-border" : ""}`}>
            {s.label}
          </li>
        );
      })}
    </ol>
  );
}
