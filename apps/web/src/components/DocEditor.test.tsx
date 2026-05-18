import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Mock Tiptap hooks — the real editor requires a full browser DOM with
// selection APIs that jsdom does not fully support.
vi.mock("@tiptap/react", () => ({
  useEditor: vi.fn(() => null),
  EditorContent: ({ editor }: { editor: unknown }) =>
    editor ? <div data-testid="editor-content" /> : null,
}));

vi.mock("@tiptap/react/menus", () => ({
  BubbleMenu: () => null,
  FloatingMenu: () => null,
}));

// Also mock all extension packages so they don't throw in jsdom
vi.mock("@tiptap/starter-kit", () => ({ default: {} }));
vi.mock("@tiptap/extension-placeholder", () => ({ default: { configure: vi.fn(() => ({})) } }));
vi.mock("@tiptap/extension-link", () => ({ default: { configure: vi.fn(() => ({})) } }));
vi.mock("@tiptap/extension-task-list", () => ({ default: {} }));
vi.mock("@tiptap/extension-task-item", () => ({ default: { configure: vi.fn(() => ({})) } }));
vi.mock("@tiptap/extension-table", () => ({
  Table: { configure: vi.fn(() => ({})) },
  TableRow: {},
  TableCell: {},
  TableHeader: {},
}));
vi.mock("@tiptap/extension-typography", () => ({ default: {} }));
vi.mock("@tiptap/extension-character-count", () => ({ default: {} }));
vi.mock("@tiptap/extension-underline", () => ({ default: {} }));

import { DocEditor } from "./DocEditor";

describe("DocEditor", () => {
  it("renders without crashing", () => {
    const { container } = render(<DocEditor value={null} onChange={() => {}} />);
    expect(container.querySelector("[data-editor-root]")).toBeTruthy();
  });

  it("renders read-only without toolbar", () => {
    const { container } = render(<DocEditor value={null} onChange={() => {}} readOnly />);
    expect(container.querySelector("[data-editor-root]")).toBeTruthy();
  });
});
