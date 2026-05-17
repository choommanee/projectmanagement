import { describe, it, expect } from "vitest";
import { isEmail, isUuid, isSlug, passwordIssue } from "./validation";

describe("isEmail", () => {
  it("accepts valid emails", () => {
    expect(isEmail("demo@demo.co")).toBe(true);
    expect(isEmail("user+tag@example.org")).toBe(true);
    expect(isEmail("a@b.io")).toBe(true);
  });
  it("rejects invalid emails", () => {
    expect(isEmail("not-an-email")).toBe(false);
    expect(isEmail("@missing.com")).toBe(false);
    expect(isEmail("no@tld")).toBe(false);
    expect(isEmail("")).toBe(false);
    expect(isEmail("spaces in@email.com")).toBe(false);
  });
});

describe("isUuid", () => {
  it("accepts valid UUIDs", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
  });
  it("rejects invalid UUIDs", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("550e8400-e29b-41d4-a716")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("gggggggg-0000-0000-0000-000000000000")).toBe(false);
  });
});

describe("isSlug", () => {
  it("accepts valid slugs", () => {
    expect(isSlug("demo-co")).toBe(true);
    expect(isSlug("acme")).toBe(true);
    expect(isSlug("my-company-123")).toBe(true);
    expect(isSlug("a1")).toBe(true);
  });
  it("rejects invalid slugs", () => {
    expect(isSlug("UPPERCASE")).toBe(false);
    expect(isSlug("-starts-with-dash")).toBe(false);
    expect(isSlug("")).toBe(false);
    expect(isSlug("a")).toBe(false); // only 1 char total, need at least 2
    expect(isSlug("has spaces")).toBe(false);
  });
});

describe("passwordIssue", () => {
  it("returns null for valid passwords", () => {
    expect(passwordIssue("DemoPass#2026")).toBe(null);
    expect(passwordIssue("1234567890")).toBe(null);
    expect(passwordIssue("exactly-10")).toBe(null);
  });
  it("returns error message for short passwords", () => {
    expect(passwordIssue("short")).not.toBeNull();
    expect(passwordIssue("")).not.toBeNull();
    expect(passwordIssue("9chars---")).not.toBeNull();
  });
  it("error message mentions 10 chars", () => {
    const msg = passwordIssue("short");
    expect(msg).toContain("10");
  });
});
