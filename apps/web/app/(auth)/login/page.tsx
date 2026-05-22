"use client";

import { useState, useCallback, Suspense, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input } from "@pmplatform/ui-kit";
import { Check } from "lucide-react";
import { isEmail, isUuid, isSlug, passwordIssue } from "@/lib/validation";
import "./login.css";

type Mode = "slug" | "uuid" | "demo";

interface FieldError {
  slug?: string;
  uuid?: string;
  email?: string;
  password?: string;
  form?: string;
}

function FieldInput({ label, onChange, ...rest }: { label: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "size">) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{label}</span>
      <Input {...rest} onChange={(e) => onChange((e.target as HTMLInputElement).value)} />
    </label>
  );
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
        if (err) next.slug = err; else delete next.slug;
      } else if (field === "uuid") {
        const err = validateUuid(value);
        if (err) next.uuid = err; else delete next.uuid;
      } else if (field === "email") {
        const err = validateEmail(value);
        if (err) next.email = err; else delete next.email;
      } else if (field === "password") {
        const err = validatePassword(value);
        if (err) next.password = err; else delete next.password;
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

    if (mode === "demo") {
      setBusy(true);
      try {
        const res = await fetch("/api/auth/demo", { method: "POST" });
        if (!res.ok) { setErrors({ form: "Demo mode unavailable, try again." }); return; }
        router.push("/pm/home");
      } catch {
        setErrors({ form: "Cannot reach server for demo mode." });
      } finally {
        setBusy(false);
      }
      return;
    }

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

      router.push(nextPath);
    } catch {
      setErrors({ form: "Cannot reach identity service. Check your connection." });
    } finally {
      setBusy(false);
    }
  }

  const brandFeatures = [
    "Project portfolio & WBS planning",
    "Visual workflow automation",
    "IATF 16949 quality & traceability",
  ];

  const modeTabs: { id: Mode; label: string }[] = [
    { id: "slug", label: "Tenant slug" },
    { id: "uuid", label: "Tenant ID" },
    { id: "demo", label: "Demo" },
  ];

  return (
    <div className="flex min-h-screen">
      {/* Left brand panel */}
      <aside className="login-brand-panel hidden lg:flex w-120 flex-col justify-between bg-ink p-12 text-paper">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-sm bg-paper text-ink font-mono text-[13px] font-semibold">PM</span>
            <span className="font-semibold tracking-tight">PM Platform</span>
          </div>
        </div>
        <div className="space-y-6">
          <h1 className="text-[40px] font-semibold leading-[1.05] tracking-tight">
            Project + Manufacturing,<br />
            <span className="text-signal">in one place.</span>
          </h1>
          <p className="max-w-sm text-sm text-[#B6BDC8]">
            Built for tier-1 manufacturers and SI partners delivering on IATF 16949. Workflow automation, traceability, and a Dynamics-grade shell — without the legacy.
          </p>
          <ul className="space-y-2.5 text-sm text-[#B6BDC8]">
            {brandFeatures.map((line) => (
              <li key={line} className="flex items-center gap-2">
                <Check size={14} className="text-signal" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div className="text-[11px] text-[#767E8A]">© 2026 PM Platform • All rights reserved</div>
      </aside>

      {/* Right form panel */}
      <main className="relative flex flex-1 items-center justify-center bg-paper p-6">
        <div className="w-full max-w-105">
          {/* Mobile logo */}
          <div className="lg:hidden mb-8 text-center">
            <span className="grid h-10 w-10 mx-auto place-items-center rounded-sm bg-ink text-paper font-mono text-sm">PM</span>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-ink-3">Welcome back. Sign in to your workspace.</p>

          {/* Mode tabs */}
          <div className="mt-6 grid grid-cols-3 gap-1 rounded-sm bg-surface-2 p-1">
            {modeTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setMode(t.id); setErrors({}); }}
                className={`h-8 rounded-xs text-[13px] font-medium transition-colors ${mode === t.id ? "bg-surface text-ink shadow-xs" : "text-ink-3 hover:text-ink-2"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
            {mode === "slug" && (
              <div>
                <FieldInput
                  label="Tenant slug"
                  value={slug}
                  onChange={(v) => { setSlug(v); revalidate("slug", v); }}
                  onBlur={() => { touch("slug"); revalidate("slug", slug); }}
                  placeholder="acme"
                  autoComplete="organization"
                  aria-invalid={!!(touched.slug && errors.slug)}
                />
                {touched.slug && errors.slug && <p className="mt-1 text-xs text-danger">{errors.slug}</p>}
              </div>
            )}

            {mode === "uuid" && (
              <div>
                <FieldInput
                  label="Tenant ID (UUID)"
                  value={uuid}
                  onChange={(v) => { setUuid(v); revalidate("uuid", v); }}
                  onBlur={() => { touch("uuid"); revalidate("uuid", uuid); }}
                  className="font-mono"
                  placeholder="00000000-0000-0000-0000-000000000000"
                  autoComplete="off"
                  aria-invalid={!!(touched.uuid && errors.uuid)}
                />
                {touched.uuid && errors.uuid && <p className="mt-1 text-xs text-danger">{errors.uuid}</p>}
              </div>
            )}

            {mode === "demo" && (
              <p className="text-sm text-ink-3">
                Instantly enter the platform as a demo user. No credentials needed.
              </p>
            )}

            {mode !== "demo" && (
              <>
                <div>
                  <FieldInput
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(v) => { setEmail(v); revalidate("email", v); }}
                    onBlur={() => { touch("email"); revalidate("email", email); }}
                    autoComplete="email"
                    aria-invalid={!!(touched.email && errors.email)}
                  />
                  {touched.email && errors.email && <p className="mt-1 text-xs text-danger">{errors.email}</p>}
                </div>
                <div>
                  <FieldInput
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(v) => { setPassword(v); revalidate("password", v); }}
                    onBlur={() => { touch("password"); revalidate("password", password); }}
                    autoComplete="current-password"
                    aria-invalid={!!(touched.password && errors.password)}
                  />
                  {touched.password && errors.password && <p className="mt-1 text-xs text-danger">{errors.password}</p>}
                </div>
              </>
            )}

            {errors.form && (
              <div className="rounded-sm border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
                {errors.form}
                {errors.form.includes("identity service") && (
                  <a href="/docs/troubleshooting" className="ml-1 underline" target="_blank" rel="noreferrer">View docs</a>
                )}
              </div>
            )}

            <Button
              type="submit"
              variant={mode === "demo" ? "secondary" : "primary"}
              size="lg"
              className="w-full"
              loading={busy}
              disabled={busy || (mode !== "demo" && !allValid())}
            >
              {mode === "demo" ? "Continue as Demo User" : busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 text-center text-[12px] text-ink-3">
            Need an account?{" "}
            <a className="text-accent hover:underline" href="#">Contact sales</a>
          </p>
        </div>
      </main>
    </div>
  );
}

// Outer page wraps the form in Suspense so useSearchParams() works in builds
export default function LoginPage() {
  return (
    <Suspense fallback={
      <main className="grid min-h-screen place-items-center bg-paper">
        <div className="text-sm text-ink-3">Loading…</div>
      </main>
    }>
      <LoginForm />
    </Suspense>
  );
}
