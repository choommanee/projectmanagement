/** RFC-ish email regex */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** UUID v4 (also accepts other versions for flexibility) */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tenant slug: lowercase alphanumeric start, then alphanumeric + hyphens, 2–63 chars total */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function isEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

export function isUuid(s: string): boolean {
  return UUID_RE.test(s.trim());
}

export function isSlug(s: string): boolean {
  return SLUG_RE.test(s.trim());
}

/**
 * Returns null if password is valid, or a human-readable error string.
 */
export function passwordIssue(s: string): string | null {
  if (s.length < 10) return "Password must be at least 10 characters";
  return null;
}
