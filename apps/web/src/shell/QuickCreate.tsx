"use client";
import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@pmplatform/ui-kit";

export function QuickCreate({ trigger, title, children, onSubmit }:
  { trigger: ReactNode; title: string; children: ReactNode; onSubmit: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>
      {open && (
        <div role="dialog" aria-label={title} className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/30" onClick={() => setOpen(false)} />
          <div className="w-[420px] border-l border-border bg-bg p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{title}</h2>
              <button aria-label="Close" onClick={() => setOpen(false)}><X size={14} /></button>
            </div>
            <div>{children}</div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={async () => { await onSubmit(); setOpen(false); }}>Create</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
