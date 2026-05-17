import { describe, it, expect } from "vitest";
import { applyFilter } from "./filter";

const rows = [
  { no: "WO-1", status: "open",   qty: 10 },
  { no: "WO-2", status: "closed", qty: 20 },
  { no: "WO-3", status: "open",   qty: 30 },
];

describe("applyFilter", () => {
  it("returns all rows when filter undefined", () => {
    expect(applyFilter(rows)).toEqual(rows);
  });
  it("eq", () => {
    expect(applyFilter(rows, { field: "status", op: "eq", value: "open" }).length).toBe(2);
  });
  it("gt", () => {
    expect(applyFilter(rows, { field: "qty", op: "gt", value: 15 }).length).toBe(2);
  });
  it("contains", () => {
    expect(applyFilter(rows, { field: "no", op: "contains", value: "WO-2" }).length).toBe(1);
  });
  it("in", () => {
    expect(applyFilter(rows, { field: "status", op: "in", value: ["closed"] }).length).toBe(1);
  });
});
