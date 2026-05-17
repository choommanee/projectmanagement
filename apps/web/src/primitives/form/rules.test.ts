import { describe, it, expect } from "vitest";
import { evaluateRules } from "./rules";

describe("evaluateRules", () => {
  it("applies set when condition matches", () => {
    const out = evaluateRules(
      [{ when: "status == 'closed'", set: [{ field: "amount", readOnly: true }] }],
      { status: "closed", amount: 5 },
    );
    expect(out["amount"]).toEqual({ field: "amount", readOnly: true });
  });
  it("ignores when condition false", () => {
    const out = evaluateRules(
      [{ when: "status == 'open'", set: [{ field: "amount", hidden: true }] }],
      { status: "closed" },
    );
    expect(out["amount"]).toBeUndefined();
  });
  it("handles && combinator", () => {
    const out = evaluateRules(
      [{ when: "status == 'closed' && amount > 100", set: [{ field: "lock", readOnly: true }] }],
      { status: "closed", amount: 200 },
    );
    expect(out["lock"]?.readOnly).toBe(true);
  });
  it("handles || combinator", () => {
    const out = evaluateRules(
      [{ when: "status == 'a' || status == 'b'", set: [{ field: "x", hidden: true }] }],
      { status: "b" },
    );
    expect(out["x"]?.hidden).toBe(true);
  });
});
