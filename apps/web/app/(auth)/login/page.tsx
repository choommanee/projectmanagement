"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@pmplatform/ui-kit";

export default function Login() {
  const r = useRouter();
  const [tenantId, setTenantId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const r2 = await fetch("http://localhost:8082/v1/login", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, email, password }),
      });
      if (!r2.ok) { setErr(`Login failed (${r2.status})`); return; }
      const tp = await r2.json();
      localStorage.setItem("access_token", tp.access_token);
      r.push("/pm/home");
    } catch (e: unknown) {
      setErr(`Network error — is identity-svc running on :8082? (${(e as Error).message})`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bgMuted">
      <form onSubmit={submit} className="w-[420px] rounded-lg border border-border bg-bg p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-xs text-fgMuted">PM + Manufacturing Platform</p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs text-fgMuted">Tenant ID (UUID)</span>
            <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
          </label>
          <label className="block">
            <span className="text-xs text-fgMuted">Email</span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-fgMuted">Password</span>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        </div>

        {err && <div className="mt-3 rounded border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{err}</div>}

        <Button type="submit" variant="primary" className="mt-4 w-full" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>

        <p className="mt-3 text-xs text-fgMuted">
          Or go to <a className="text-primary underline" href="/pm/home">/pm/home</a> (demo mode, no auth).
        </p>
      </form>
    </main>
  );
}
