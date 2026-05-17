import { describe, it, expect } from "vitest";
import { locales, defaultLocale, loadMessages } from "./i18n";

describe("i18n", () => {
  it("supports en and th", () => {
    expect(locales).toEqual(["en", "th"]);
    expect(defaultLocale).toBe("en");
  });
  it("loads EN messages with shell.search='Search'", async () => {
    const m = await loadMessages("en") as { shell: { search: string } };
    expect(m.shell.search).toBe("Search");
  });
  it("loads TH messages with shell.search='ค้นหา'", async () => {
    const m = await loadMessages("th") as { shell: { search: string } };
    expect(m.shell.search).toBe("ค้นหา");
  });
});
