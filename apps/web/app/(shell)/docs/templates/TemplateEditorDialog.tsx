"use client";
import { useEffect, useState } from "react";
import { Button, Dialog, Input } from "@pmplatform/ui-kit";
import { DocEditor } from "@/components/DocEditor";
import {
  createTemplate, updateTemplate,
  type Template, type DocumentType,
} from "@/lib/api/documents";
import { TYPES_BY_KIND } from "@/lib/api/documents";

// Flatten the kind→types map into grouped <optgroup> options so the author
// picks from the real document-type enum, not a free-text field.
const TYPE_GROUPS: { kind: string; label: string; types: { value: DocumentType; label: string }[] }[] = [
  { kind: "pm", label: "Project Management", types: TYPES_BY_KIND.pm },
  { kind: "ba", label: "Business Analysis", types: TYPES_BY_KIND.ba },
  { kind: "sa", label: "Solution Architecture", types: TYPES_BY_KIND.sa },
  { kind: "expert", label: "Expert / Knowledge", types: TYPES_BY_KIND.expert },
];

const EMPTY_BODY = { type: "doc", content: [{ type: "paragraph" }] };

export type TemplateEditorMode = "create" | "edit" | "duplicate";

export function TemplateEditorDialog({
  open, mode, source, onClose, onSaved,
}: {
  open: boolean;
  mode: TemplateEditorMode;
  // For edit/duplicate, the template to seed from. Null for a blank create.
  source?: Template | null;
  onClose: () => void;
  onSaved: (t: Template) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<DocumentType>("note");
  const [body, setBody] = useState<Record<string, unknown>>(EMPTY_BODY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed form whenever the dialog is (re)opened.
  useEffect(() => {
    if (!open) return;
    if (mode === "create") {
      setName("");
      setType("note");
      setBody(EMPTY_BODY);
    } else if (source) {
      setName(mode === "duplicate" ? `${source.name} (copy)` : source.name);
      setType(source.type);
      setBody(source.body && Object.keys(source.body).length > 0 ? source.body : EMPTY_BODY);
    }
    setError(null);
  }, [open, mode, source]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!name.trim()) { setError("Name is required."); return; }
    setLoading(true); setError(null);
    try {
      let saved: Template;
      if (mode === "edit" && source) {
        saved = await updateTemplate(source.id, { name: name.trim(), type, body });
      } else {
        // create + duplicate both POST a new template
        saved = await createTemplate({ name: name.trim(), type, body });
      }
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setLoading(false);
    }
  }

  const title =
    mode === "edit" ? "Edit Template" :
    mode === "duplicate" ? "Duplicate Template" :
    "New Template";

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="flex max-h-[80vh] flex-col">
        <div className="space-y-4 overflow-y-auto p-4">
          {error && (
            <div className="rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">{error}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-3">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Project Charter Skeleton" />
            </div>
            <div className="space-y-1">
              <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-3">Document Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as DocumentType)}
                className="w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              >
                {TYPE_GROUPS.map((g) => (
                  <optgroup key={g.kind} label={g.label}>
                    {g.types.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </optgroup>
                ))}
                <option value="note">Note</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-3">Template Body</label>
            <div className="rounded-sm border border-line bg-surface">
              <DocEditor
                value={body}
                onChange={setBody}
                placeholder="Write the template structure — headings, sections, tables, checklists…"
              />
            </div>
            <p className="font-mono text-[10px] text-ink-3">
              This is the content every new document made from this template starts with.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line p-4">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={loading}>
            {loading ? "Saving…" : mode === "edit" ? "Save Changes" : "Create Template"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
