import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DashboardGrid } from "./DashboardGrid";
import type { DashboardDef } from "./dashboard.types";

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
});

const def: DashboardDef = {
  id: "exec", name: "Exec",
  widgets: [
    { id: "w1", kind: "kpi",  x: 0, y: 0, w: 3, h: 2, config: { title: "Open WOs", value: 42 } },
    { id: "w2", kind: "list", x: 3, y: 0, w: 6, h: 3, config: { title: "Recent",   items: [{ label: "WO-1" }] } },
  ],
};

describe("DashboardGrid", () => {
  it("renders widget titles", () => {
    render(<DashboardGrid def={def} />);
    expect(screen.getByText("Open WOs")).toBeInTheDocument();
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });
});
