"use client";

import { useEffect, useId, useRef, useState } from "react";

interface MermaidBlockProps {
  code: string;
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const rawId = useId().replace(/:/g, "");
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [showCode, setShowCode] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        if (!initialized.current) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "neutral",
            fontFamily: "JetBrains Mono, monospace",
          });
          initialized.current = true;
        }
        const { svg: rendered } = await mermaid.render(
          `mermaid-${rawId}`,
          code.trim(),
        );
        if (!cancelled) {
          setSvg(rendered);
          setError("");
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, [code, rawId]);

  return (
    <div className="my-3 overflow-hidden rounded-sm border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line bg-paper px-3 py-1.5">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
          mermaid diagram
        </span>
        <button
          type="button"
          onClick={() => setShowCode((v) => !v)}
          className="font-mono text-[10px] text-ink-3 hover:text-accent"
        >
          {showCode ? "> Preview" : "</> Code"}
        </button>
      </div>
      {showCode ? (
        <pre className="overflow-auto bg-paper px-4 py-3 text-[12px] text-ink-2">
          <code>{code}</code>
        </pre>
      ) : error ? (
        <div className="px-4 py-3 text-[12px] text-danger">
          Diagram error: {error}
        </div>
      ) : svg ? (
        <div
          className="flex justify-center overflow-auto px-4 py-4"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="px-4 py-3 text-[12px] text-ink-3">Rendering...</div>
      )}
    </div>
  );
}
