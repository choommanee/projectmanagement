// Phase 1 stub — real next-intl middleware wiring deferred to Phase 2.
export const locales = ["en", "th"] as const;
export type Locale = typeof locales[number];
export const defaultLocale: Locale = "en";

export async function loadMessages(locale: Locale): Promise<Record<string, unknown>> {
  if (locale === "th") return (await import("../../public/locales/th/common.json")).default;
  return (await import("../../public/locales/en/common.json")).default;
}
