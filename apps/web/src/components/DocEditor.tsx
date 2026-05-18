"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu, FloatingMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import Typography from "@tiptap/extension-typography";
import CharacterCount from "@tiptap/extension-character-count";
import Underline from "@tiptap/extension-underline";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DocEditorProps {
  value: Record<string, unknown> | null;
  onChange: (json: Record<string, unknown>) => void;
  readOnly?: boolean;
  placeholder?: string;
}

// ─── Toolbar button helper ────────────────────────────────────────────────────

function ToolBtn({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`inline-flex h-7 min-w-[28px] items-center justify-center rounded-xs px-1.5 text-[12px] font-medium transition-colors ${
        active
          ? "bg-accent text-surface"
          : "text-ink-2 hover:bg-surface-2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Link prompt state ────────────────────────────────────────────────────────

function LinkInput({ onSet, onClose }: { onSet: (url: string) => void; onClose: () => void }) {
  const [val, setVal] = useState("");
  return (
    <div className="flex items-center gap-1 rounded-sm border border-line bg-surface p-1 shadow-sm">
      <input
        autoFocus
        className="h-6 min-w-48 border-0 bg-transparent px-1 text-[12px] text-ink outline-none"
        placeholder="https://…"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onSet(val); }
          if (e.key === "Escape") { e.preventDefault(); onClose(); }
        }}
      />
      <button
        type="button"
        className="h-6 rounded-xs bg-accent px-2 text-[11px] font-medium text-surface"
        onClick={() => onSet(val)}
      >
        Set
      </button>
      <button
        type="button"
        className="h-6 rounded-xs px-1.5 text-[11px] text-ink-3 hover:text-ink"
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}

// ─── DocEditor ────────────────────────────────────────────────────────────────

export function DocEditor({ value, onChange, readOnly = false, placeholder = "Start writing…" }: DocEditorProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showLinkInput, setShowLinkInput] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({ placeholder }),
      Link.configure({ openOnClick: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Typography,
      CharacterCount,
    ],
    content: value ?? { type: "doc", content: [] },
    editable: !readOnly,
    onUpdate({ editor }) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onChange(editor.getJSON() as Record<string, unknown>);
      }, 400);
    },
  });

  // Sync external value changes (e.g. version restore)
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = JSON.stringify(editor.getJSON());
    const next = JSON.stringify(value ?? { type: "doc", content: [] });
    if (current !== next) {
      editor.commands.setContent(value ?? { type: "doc", content: [] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const charCount = editor?.storage.characterCount?.characters?.() ?? 0;

  const setLink = useCallback((url: string) => {
    if (!editor) return;
    setShowLinkInput(false);
    if (!url) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const href = url.startsWith("http") ? url : `https://${url}`;
    editor.chain().focus().setLink({ href }).run();
  }, [editor]);

  if (!editor) return <div data-editor-root className="min-h-[480px]" />;

  return (
    <div data-editor-root className="flex flex-col">
      {/* Toolbar */}
      {!readOnly && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-0.5 border-b border-line bg-paper px-2 py-1">
          {/* Headings dropdown */}
          <select
            aria-label="Heading level"
            className="h-7 appearance-none rounded-xs border border-line bg-surface px-1.5 text-[12px] text-ink focus:outline-none"
            value={
              editor.isActive("heading", { level: 1 }) ? "1"
              : editor.isActive("heading", { level: 2 }) ? "2"
              : editor.isActive("heading", { level: 3 }) ? "3"
              : "p"
            }
            onChange={(e) => {
              const v = e.target.value;
              if (v === "p") editor.chain().focus().setParagraph().run();
              else editor.chain().focus().setHeading({ level: Number(v) as 1|2|3 }).run();
            }}
          >
            <option value="p">Paragraph</option>
            <option value="1">Heading 1</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
          </select>

          <span className="mx-1 h-4 w-px bg-line" />

          {/* Text formatting */}
          <ToolBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
            <strong>B</strong>
          </ToolBtn>
          <ToolBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
            <em>I</em>
          </ToolBtn>
          <ToolBtn active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline">
            <span className="underline">U</span>
          </ToolBtn>
          <ToolBtn active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
            <span className="line-through">S</span>
          </ToolBtn>
          <ToolBtn active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code">
            <span className="font-mono">`</span>
          </ToolBtn>

          <span className="mx-1 h-4 w-px bg-line" />

          {/* Lists */}
          <ToolBtn active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
            • List
          </ToolBtn>
          <ToolBtn active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Ordered list">
            1. List
          </ToolBtn>
          <ToolBtn active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()} title="Task list">
            ☑ Tasks
          </ToolBtn>

          <span className="mx-1 h-4 w-px bg-line" />

          {/* Blocks */}
          <ToolBtn active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">
            &ldquo;
          </ToolBtn>
          <ToolBtn active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code block">
            {"</>"}
          </ToolBtn>
          <ToolBtn active={false} onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal rule">
            —
          </ToolBtn>

          <span className="mx-1 h-4 w-px bg-line" />

          {/* Link */}
          <div className="relative">
            <ToolBtn active={editor.isActive("link")} onClick={() => setShowLinkInput((v) => !v)} title="Link">
              🔗
            </ToolBtn>
            {showLinkInput && (
              <div className="absolute left-0 top-full z-30 mt-1">
                <LinkInput onSet={setLink} onClose={() => setShowLinkInput(false)} />
              </div>
            )}
          </div>

          {/* Table */}
          <ToolBtn active={editor.isActive("table")} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 4, withHeaderRow: true }).run()} title="Insert table">
            ⊞ Table
          </ToolBtn>
        </div>
      )}

      {/* Bubble menu on selection */}
      {!readOnly && (
        <BubbleMenu editor={editor}>
          <div className="flex items-center gap-0.5 rounded-sm border border-line bg-surface px-1 py-0.5 shadow-sm">
            <ToolBtn active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
              <strong>B</strong>
            </ToolBtn>
            <ToolBtn active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
              <em>I</em>
            </ToolBtn>
            <ToolBtn active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} title="Code">
              <span className="font-mono">`</span>
            </ToolBtn>
            <ToolBtn active={editor.isActive("link")} onClick={() => setShowLinkInput(true)} title="Link">
              🔗
            </ToolBtn>
          </div>
        </BubbleMenu>
      )}

      {/* Floating menu on empty paragraph */}
      {!readOnly && (
        <FloatingMenu editor={editor}>
          <span className="rounded-xs border border-dashed border-line px-2 py-0.5 text-[11px] text-ink-3">
            Type / to insert
          </span>
        </FloatingMenu>
      )}

      {/* Editor content */}
      <div className="flex-1 px-4 py-3">
        <EditorContent editor={editor} />
      </div>

      {/* Footer: character count */}
      <div className="flex items-center justify-end border-t border-line px-4 py-1.5 text-[11px] text-ink-3">
        <span>{charCount} characters</span>
      </div>
    </div>
  );
}
