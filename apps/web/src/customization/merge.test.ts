import { describe, it, expect } from "vitest";
import { mergeCustomization } from "./merge";

describe("mergeCustomization", () => {
  it("deep merges objects with overrides winning", () => {
    const base = { entity: "wo", header: { title: "WO" }, tabs: [{ id: "t1", label: "G", sections: [] }] };
    const ov   = { header: { title: "Work Order" }, tabs: [{ id: "t1", label: "General", sections: [] }] };
    const m    = mergeCustomization(base, ov);
    expect(m.header.title).toBe("Work Order");
    expect(m.tabs[0].label).toBe("General");
  });
  it("appends array items when override marks _append", () => {
    const base = { tabs: [{ id: "t1" }] };
    const ov   = { tabs: { _append: [{ id: "t2" }] } };
    const m    = mergeCustomization(base, ov);
    expect((m.tabs as { id: string }[]).map((t) => t.id)).toEqual(["t1", "t2"]);
  });
  it("returns base when overrides is null/undefined", () => {
    const base = { a: 1 };
    expect(mergeCustomization(base, null)).toBe(base);
    expect(mergeCustomization(base, undefined)).toBe(base);
  });
  it("primitive override replaces base", () => {
    expect(mergeCustomization(1, 2)).toBe(2);
  });
});
