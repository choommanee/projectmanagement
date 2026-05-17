import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ListView } from "./ListView";
import type { ListDef } from "./list.types";

// jsdom doesn't implement ResizeObserver, which react-virtual relies on. Stub it.
beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
});

const def: ListDef = {
  entity: "wo",
  views: [
    { id: "all",  name: "All",  isSystem: true, columns: [
      { name: "no",     label: "WO #",    width: 120 },
      { name: "status", label: "Status",  width: 100 },
      { name: "qty",    label: "Qty",     width: 80 },
    ]},
    { id: "open", name: "Open", filter: { field: "status", op: "eq", value: "open" }, columns: [
      { name: "no", label: "WO #" }, { name: "qty", label: "Qty" },
    ]},
  ],
};

const rows = [
  { no: "WO-1", status: "open",   qty: 10 },
  { no: "WO-2", status: "closed", qty: 20 },
];

describe("ListView", () => {
  it("renders selected view's columns", () => {
    render(<ListView def={def} rows={rows} />);
    expect(screen.getByText("WO #")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
  });
  it("applies view filter (eq status=open)", () => {
    render(<ListView def={def} rows={rows} initialViewId="open" />);
    expect(screen.getByText("WO-1")).toBeInTheDocument();
    expect(screen.queryByText("WO-2")).toBeNull();
  });
  it("invokes onRowClick", () => {
    const onClick = vi.fn();
    render(<ListView def={def} rows={rows} onRowClick={onClick} />);
    fireEvent.click(screen.getByText("WO-1"));
    expect(onClick).toHaveBeenCalledWith(rows[0]);
  });
});
