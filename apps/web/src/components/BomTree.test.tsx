import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Mock the mfg API module
vi.mock("@/lib/api/mfg", () => ({
  listItems: vi.fn(async () => ({ items: [], total: 0 })),
  getBom: vi.fn(async () => ({
    id: "bom-001",
    tenantId: "t-001",
    itemId: "item-001",
    version: 1,
    isDefault: true,
    status: "draft",
    notes: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lines: [],
  })),
  activateBom: vi.fn(async () => {}),
  addBomLine: vi.fn(async () => ({
    id: "line-new",
    tenantId: "t-001",
    headerId: "bom-001",
    childItemId: "item-comp",
    qty: 2,
    uomId: "uom-ea",
    isPhantom: false,
    scrapPct: 0,
    sortOrder: 0,
    notes: "",
  })),
  updateBomLine: vi.fn(async () => ({})),
  deleteBomLine: vi.fn(async () => {}),
  explodeBom: vi.fn(async () => []),
}));

import { BomTree } from "./BomTree";
import type { BOMHeader, UOM } from "@/lib/api/mfg";

const mockUoms: UOM[] = [
  { id: "uom-ea", tenantId: "t-001", code: "EA", name: "Each", ratioToBase: 1 },
  { id: "uom-kg", tenantId: "t-001", code: "KG", name: "Kilogram", ratioToBase: 1000 },
];

const mockBomWithLines: BOMHeader = {
  id: "bom-001",
  tenantId: "t-001",
  itemId: "item-fg",
  version: 1,
  isDefault: true,
  status: "draft",
  notes: "Test BOM",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  lines: [
    {
      id: "line-001",
      tenantId: "t-001",
      headerId: "bom-001",
      childItemId: "item-comp-1",
      qty: 3,
      uomId: "uom-ea",
      isPhantom: false,
      scrapPct: 0,
      sortOrder: 10,
      notes: "",
    },
    {
      id: "line-002",
      tenantId: "t-001",
      headerId: "bom-001",
      childItemId: "item-comp-2",
      qty: 1.5,
      uomId: "uom-kg",
      isPhantom: true,
      scrapPct: 5,
      sortOrder: 20,
      notes: "",
    },
  ],
};

describe("BomTree", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it("renders BOM status and version", () => {
    render(<BomTree bom={mockBomWithLines} uoms={mockUoms} onChange={vi.fn()} />);
    expect(screen.getByText("draft")).toBeTruthy();
    expect(screen.getByText(/version 1/i)).toBeTruthy();
  });

  it("renders table columns headers", () => {
    render(<BomTree bom={mockBomWithLines} uoms={mockUoms} onChange={vi.fn()} />);
    expect(screen.getByText("Child Code")).toBeTruthy();
    expect(screen.getByText("Name")).toBeTruthy();
    expect(screen.getByText("Qty")).toBeTruthy();
    expect(screen.getByText("UOM")).toBeTruthy();
    expect(screen.getByText("Scrap %")).toBeTruthy();
    expect(screen.getByText("Phantom")).toBeTruthy();
  });

  it("renders both BOM lines", () => {
    render(<BomTree bom={mockBomWithLines} uoms={mockUoms} onChange={vi.fn()} />);
    const table = screen.getByTestId("bom-lines-table");
    expect(table).toBeTruthy();
    // 2 lines + 1 add row
    const bodyRows = table.querySelectorAll("tbody tr");
    expect(bodyRows.length).toBe(3); // 2 edit rows + 1 add row
  });

  it("renders Activate button for draft BOM", () => {
    render(<BomTree bom={mockBomWithLines} uoms={mockUoms} onChange={vi.fn()} />);
    expect(screen.getByText("Activate")).toBeTruthy();
  });

  it("does not render Activate button for active BOM", () => {
    const activeBom: BOMHeader = { ...mockBomWithLines, status: "active" };
    render(<BomTree bom={activeBom} uoms={mockUoms} onChange={vi.fn()} />);
    expect(screen.queryByText("Activate")).toBeNull();
  });

  it("renders explode section with qty input", () => {
    render(<BomTree bom={mockBomWithLines} uoms={mockUoms} onChange={vi.fn()} />);
    expect(screen.getByText(/multi-level explode/i)).toBeTruthy();
    expect(screen.getByText("Explode")).toBeTruthy();
  });

  it("renders Default tag for default BOM", () => {
    render(<BomTree bom={mockBomWithLines} uoms={mockUoms} onChange={vi.fn()} />);
    expect(screen.getByText("Default")).toBeTruthy();
  });
});
