import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Tooltip } from "./Tooltip";

// The tooltip starts at visibility:hidden until rAF commits real coords;
// pass { hidden: true } so testing-library matches accessibility-tree-hidden nodes.

describe("Tooltip", () => {
  it("appears on focus and exposes role=tooltip", () => {
    render(
      <Tooltip content="Helpful hint" delayDuration={0}>
        <button type="button">Anchor</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Anchor" });
    expect(screen.queryByRole("tooltip", { hidden: true })).not.toBeInTheDocument();
    act(() => {
      trigger.focus();
    });
    const tip = screen.getByRole("tooltip", { hidden: true });
    expect(tip).toBeInTheDocument();
    expect(tip).toHaveTextContent("Helpful hint");
  });

  it("hides on Escape", () => {
    render(
      <Tooltip content="Boop" delayDuration={0}>
        <button type="button">Anchor</button>
      </Tooltip>,
    );
    act(() => {
      screen.getByRole("button", { name: "Anchor" }).focus();
    });
    expect(screen.getByRole("tooltip", { hidden: true })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("tooltip", { hidden: true })).not.toBeInTheDocument();
  });
});
