import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CommandBar } from "./CommandBar";

describe("CommandBar", () => {
  it("renders actions and fires onClick", () => {
    const onSave = vi.fn();
    render(<CommandBar actions={[{ id: "save", label: "Save", onClick: onSave }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalled();
  });
  it("collapses extras into overflow when more than maxVisible", () => {
    const actions = Array.from({ length: 8 }, (_, i) => ({ id: String(i), label: `A${i}`, onClick: () => {} }));
    render(<CommandBar actions={actions} maxVisible={3} />);
    expect(screen.getAllByRole("button").length).toBeLessThanOrEqual(4);
  });
});
