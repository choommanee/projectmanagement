// Legacy helper kept for tests and non-React callers.
// The canonical next-intl config lives at src/i18n/request.ts.
export { locales, defaultLocale, type Locale } from "@/i18n/config";

import type { Locale } from "@/i18n/config";

export async function loadMessages(locale: Locale): Promise<Record<string, unknown>> {
  if (locale === "th") return (await import("../../messages/th.json")).default;
  return (await import("../../messages/en.json")).default;
}
