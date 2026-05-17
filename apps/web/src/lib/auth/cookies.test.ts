import { describe, it, expect } from "vitest";
import { encodeUserMeta, decodeUserMeta } from "./cookies";
import type { UserMeta } from "./cookies";

const sample: UserMeta = {
  id: "abc-123",
  email: "test@example.com",
  displayName: "Test User",
  tenantId: "tid-456",
  tenantSlug: "test-co",
};

describe("encodeUserMeta / decodeUserMeta", () => {
  it("round-trips a full UserMeta object", () => {
    const encoded = encodeUserMeta(sample);
    const decoded = decodeUserMeta(encoded);
    expect(decoded).toEqual(sample);
  });

  it("encoded value is a non-empty base64 string", () => {
    const encoded = encodeUserMeta(sample);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(0);
    // should not contain raw JSON characters at top level
    expect(encoded).not.toContain("{");
  });

  it("returns null for invalid base64", () => {
    expect(decodeUserMeta("!!!notbase64!!!")).toBeNull();
  });

  it("returns null for valid base64 that decodes to non-UserMeta JSON", () => {
    const bad = Buffer.from('{"foo":"bar"}').toString("base64");
    expect(decodeUserMeta(bad)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(decodeUserMeta("")).toBeNull();
  });

  it("preserves unicode in display name", () => {
    const u: UserMeta = { ...sample, displayName: "Søren Aaberg" };
    expect(decodeUserMeta(encodeUserMeta(u))?.displayName).toBe("Søren Aaberg");
  });
});
