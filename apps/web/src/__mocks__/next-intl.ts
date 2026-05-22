import { vi } from "vitest";

// Identity translator — returns the key passed in, sufficient for component
// tests that don't assert on translated strings.
export const useTranslations = vi.fn(
  () => (key: string, _values?: Record<string, unknown>) => key,
);

export const useLocale = vi.fn(() => "en");

export const NextIntlClientProvider = ({ children }: { children: React.ReactNode }) => children;
