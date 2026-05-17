import { describe, it, expect } from "vitest";
import { tokens } from "./index";

describe("design tokens", () => {
  it("exposes color.primary", () => {
    expect(tokens.color.primary).toBe("#0B5CFF");
  });
  it("exposes radius.md", () => {
    expect(tokens.radius.md).toBe("6px");
  });
});
