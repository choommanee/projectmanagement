"use client";

import { useState, useCallback, Suspense, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input } from "@pmplatform/ui-kit";
import { isEmail, isUuid, isSlug, passwordIssue } from "@/lib/validation";
import { Loader2 } from "lucide-react";

type Mode = "slug" | "uuid" | "demo";

interface FieldError {
  slug?: string;
  uuid?: string;
  email?: string;
  password?: string;
  form?: string;
}

// Inner component that calls useSearchParams — must be inside Suspense
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") ?? "/pm/home";

  const [mode, setMode] = useState<Mode>("slug");
  const [slug, setSlug] = useState("");
  const [uuid, setUuid] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldError>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  // -- Inline validators --
  const validateSlug = useCallback(
    (v: string) =>
      v.trim() === "" ? "Tenant slug is required" : !isSlug(v.trim()) ? "Invalid slug (lowercase letters, digits, hyphens)" : undefined,
    [],
  );
  const validateUuid = useCallback(
    (v: string) =>
      v.trim() === "" ? "Tenant ID is required" : !isUuid(v.trim()) ? "Invalid UUID format" : undefined,
    [],
  );
  const validateEmail = useCallback(
    (v: string) =>
      v.trim() === "" ? "Email is required" : !isEmail(v.trim()) ? "Enter a valid email address" : undefined,
    [],
  );
  const validatePassword = useCallback(
    (v: string) => (v === "" ? "Password is required" : passwordIssue(v) ?? undefined),
    [],
  );

  function touch(field: string) {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }

  function revalidate(field: string, value: string) {
    setErrors((prev) => {
      const next = { ...prev };
      if (field === "slug") {
        const err = validateSlug(value);
        if (err) next.slug = err;
        else delete next.slug;
      } else if (field === "uuid") {
        const err = validateUuid(value);
        if (err) next.uuid = err;
        else delete next.uuid;
      } else if (field === "email") {
        const err = validateEmail(value);
        if (err) next.email = err;
        else delete next.email;
      } else if (field === "password") {
        const err = validatePassword(value);
        if (err) next.password = err;
        else delete next.password;
      }
      return next;
    });
  }

  function allValid(): boolean {
    const emailOk = !validateEmail(email);
    const passwordOk = !validatePassword(password);
    if (mode === "slug") return !validateSlug(slug) && emailOk && passwordOk;
    if (mode === "uuid") return !validateUuid(uuid) && emailOk && passwordOk;
    return true;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErrors({});

    // Force-validate all fields
    const newErrors: FieldError = {};
    if (mode === "slug") {
      const err = validateSlug(slug);
      if (err) newErrors.slug = err;
    }
    if (mode === "uuid") {
      const err = validateUuid(uuid);
      if (err) newErrors.uuid = err;
    }
    const emailErr = validateEmail(email);
    if (emailErr) newErrors.email = emailErr;
    const pwErr = validatePassword(password);
    if (pwErr) newErrors.password = pwErr;

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setTouched({ slug: true, uuid: true, email: true, password: true });
      return;
    }

    setBusy(true);
    try {
      const body: Record<string, string> = { email, password };
      if (mode === "slug") body.tenant_slug = slug.trim();
      else body.tenant_id = uuid.trim();

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 503) {
        setErrors({ form: "Cannot reach identity service. Check that services are running." });
        return;
      }
      if (res.status === 401) {
        setErrors({ form: "Invalid email or password." });
        return;
      }
      if (res.status === 404) {
        const data = await res.json() as { error?: string };
        if (mode === "slug") {
          setErrors({ slug: data.error ?? `Tenant '${slug}' not found` });
        } else {
          setErrors({ form: data.error ?? "Tenant not found" });
        }
        return;
      }
      if (!res.ok) {
        setErrors({ form: `Server error, try again (${res.status})` });
        return;
      }

      // Success — middleware or the page will take over
      router.push(nextPath);
    } catch {
      setErrors({ form: "Cannot reach identity service. Check your connection." });
    } finally {
      setBusy(false);
    }
  }

  async function handleDemo() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/demo", { method: "POST" });
      if (!res.ok) {
        setErrors({ form: "Demo mode unavailable, try again." });
        return;
      }
      router.push("/pm/home");
    } catch {
      setErrors({ form: "Cannot reach server for demo mode." });
    } finally {
      setBusy(false);
    }
  }

  const tabs: { id: Mode; label: string }[] = [
    { id: "slug", label: "By tenant slug" },
    { id: "uuid", label: "By tenant ID" },
    { id: "demo", label: "Demo mode" },
  ];

  return (
    <main className="grid min-h-screen place-items-center bg-bgMuted">
      <div className="w-[440px] rounded-lg border border-border bg-bg p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-xs text-fgMuted">PM + Manufacturing Platform</p>

        {/* Tabs */}
        <div className="mt-4 flex gap-1 rounded-md border border-border bg-bgMuted p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setMode(t.id);
                setErrors({});
              }}
              className={[
                "flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors",
                mode === t.id
                  ? "bg-bg shadow-sm text-fg"
                  : "text-fgMuted hover:text-fg",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>

        {mode === "demo" ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-fgMuted">
              Instantly enter the platform as a demo user. No credentials needed.
            </p>
            {errors.form && (
              <div className="rounded border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
                {errors.form}
              </div>
            )}
            <Button
              type="button"
              variant="primary"
              className="w-full"
              disabled={busy}
              onClick={handleDemo}
            >
              {busy ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Entering demo…
                </span>
              ) : (
                "Continue as Demo User"
              )}
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-3" noValidate>
            {/* Tenant identifier */}
            {mode === "slug" && (
              <div>
                <label className="block">
                  <span className="text-xs text-fgMuted">Tenant slug</span>
                  <Input
                    value={slug}
                    onChange={(e) => {
                      setSlug(e.target.value);
                      revalidate("slug", e.target.value);
                    }}
                    onBlur={() => {
                      touch("slug");
                      revalidate("slug", slug);
                    }}
                    placeholder="acme"
                    autoComplete="organization"
                    aria-invalid={!!(touched.slug && errors.slug)}
                  />
                </label>
                {touched.slug && errors.slug && (
                  <p className="mt-1 text-xs text-danger">{errors.slug}</p>
                )}
              </div>
            )}

            {mode === "uuid" && (
              <div>
                <label className="block">
                  <span className="text-xs text-fgMuted">Tenant ID (UUID)</span>
                  <Input
                    value={uuid}
                    onChange={(e) => {
                      setUuid(e.target.value);
                      revalidate("uuid", e.target.value);
                    }}
                    onBlur={() => {
                      touch("uuid");
                      revalidate("uuid", uuid);
                    }}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    autoComplete="off"
                    aria-invalid={!!(touched.uuid && errors.uuid)}
                  />
                </label>
                {touched.uuid && errors.uuid && (
                  <p className="mt-1 text-xs text-danger">{errors.uuid}</p>
                )}
              </div>
            )}

            {/* Email */}
            <div>
              <label className="block">
                <span className="text-xs text-fgMuted">Email</span>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    revalidate("email", e.target.value);
                  }}
                  onBlur={() => {
                    touch("email");
                    revalidate("email", email);
                  }}
                  autoComplete="email"
                  aria-invalid={!!(touched.email && errors.email)}
                />
              </label>
              {touched.email && errors.email && (
                <p className="mt-1 text-xs text-danger">{errors.email}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block">
                <span className="flex items-center justify-between text-xs text-fgMuted">
                  <span>Password</span>
                  <span className={password.length < 10 ? "text-fgMuted" : "text-success"}>
                    {password.length} / 10 min
                  </span>
                </span>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    revalidate("password", e.target.value);
                  }}
                  onBlur={() => {
                    touch("password");
                    revalidate("password", password);
                  }}
                  autoComplete="current-password"
                  aria-invalid={!!(touched.password && errors.password)}
                />
              </label>
              {touched.password && errors.password && (
                <p className="mt-1 text-xs text-danger">{errors.password}</p>
              )}
            </div>

            {/* Form-level error */}
            {errors.form && (
              <div className="rounded border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
                {errors.form}
                {errors.form.includes("identity service") && (
                  <a
                    href="/docs/troubleshooting"
                    className="ml-1 underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    View docs
                  </a>
                )}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={busy || !allValid()}
            >
              {busy ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Signing in…
                </span>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}

// Outer page wraps the form in Suspense so useSearchParams() works in builds
export default function LoginPage() {
  return (
    <Suspense fallback={
      <main className="grid min-h-screen place-items-center bg-bgMuted">
        <div className="text-sm text-fgMuted">Loading…</div>
      </main>
    }>
      <LoginForm />
    </Suspense>
  );
}
