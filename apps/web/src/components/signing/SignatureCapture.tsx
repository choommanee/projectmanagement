"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@pmplatform/ui-kit";

export interface SignatureValue {
  typedName: string;
  /** data URL "data:image/png;base64,..." when drawn, else null */
  imageDataUrl: string | null;
}

interface Props {
  /** default name to seed the typed field with */
  defaultName?: string;
  onChange: (v: SignatureValue) => void;
}

type Mode = "type" | "draw";

/**
 * Zero-dependency signature capture. Two modes:
 *  - "type": typed full legal name (rendered in a script-like face)
 *  - "draw": freehand on an HTML canvas → PNG data URL
 * Emits both fields up so the parent can build the sign request body
 * (typed_name + signature_image_b64).
 */
export function SignatureCapture({ defaultName = "", onChange }: Props) {
  const t = useTranslations("signing");
  const [mode, setMode] = useState<Mode>("type");
  const [typedName, setTypedName] = useState(defaultName);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // bubble up combined value
  useEffect(() => {
    onChange({ typedName, imageDataUrl: mode === "draw" ? imageDataUrl : null });
  }, [typedName, imageDataUrl, mode, onChange]);

  const pos = (e: PointerEvent | React.PointerEvent, c: HTMLCanvasElement) => {
    const rect = c.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (c.width / rect.width),
      y: (e.clientY - rect.top) * (c.height / rect.height),
    };
  };

  const start = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c) return;
    c.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e, c);
  }, []);

  const move = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c || !drawing.current || !last.current) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const p = pos(e, c);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }, []);

  const end = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !drawing.current) return;
    drawing.current = false;
    last.current = null;
    setImageDataUrl(c.toDataURL("image/png"));
  }, []);

  const clear = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx?.clearRect(0, 0, c.width, c.height);
    setImageDataUrl(null);
  }, []);

  return (
    <div className="space-y-2">
      {/* mode tabs */}
      <div className="inline-flex rounded-xs border border-line bg-surface-2 p-0.5">
        {(["type", "draw"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-xs px-3 py-1 text-[11px] font-medium transition-colors ${
              mode === m ? "bg-surface text-ink shadow-xs" : "text-ink-3 hover:text-ink"
            }`}
          >
            {m === "type" ? t("signTab") : t("drawTab")}
          </button>
        ))}
      </div>

      {mode === "type" ? (
        <div className="space-y-1.5">
          <input
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder={t("typedNamePlaceholder")}
            className="h-9 w-full rounded-xs border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none"
          />
          {typedName.trim() && (
            <div className="flex h-16 items-center justify-center rounded-xs border border-dashed border-line bg-surface-2">
              <span className="text-2xl italic text-ink" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>
                {typedName}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="rounded-xs border border-line bg-surface">
            <canvas
              ref={canvasRef}
              width={520}
              height={140}
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={end}
              onPointerLeave={end}
              className="h-[140px] w-full touch-none rounded-xs"
              style={{ cursor: "crosshair" }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-ink-3">{t("drawHint")}</span>
            <Button variant="ghost" size="sm" onClick={clear}>
              {t("clear")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
