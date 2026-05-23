import { currentUser } from "@/lib/auth/me";
import { redirect } from "next/navigation";

export const metadata = { title: "Profile — PM Platform" };

export default async function ProfilePage() {
  const user = await currentUser();

  if (!user) {
    redirect("/login?next=/profile");
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="rounded-sm border border-line bg-paper p-5">
        <div className="flex items-center gap-4 border-b border-line pb-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent font-mono text-lg font-semibold text-white">
            {user.displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="font-semibold text-ink">{user.displayName}</div>
            <div className="font-mono text-[11px] text-ink-3">{user.email}</div>
          </div>
        </div>

        <dl className="mt-4 space-y-2 text-[12px]">
          <div className="flex gap-4">
            <dt className="w-28 font-mono text-[10px] uppercase tracking-wider text-ink-3">User ID</dt>
            <dd className="font-mono text-[11px] text-ink">{user.id}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-28 font-mono text-[10px] uppercase tracking-wider text-ink-3">Email</dt>
            <dd className="text-ink">{user.email}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-28 font-mono text-[10px] uppercase tracking-wider text-ink-3">Tenant</dt>
            <dd className="text-ink">
              {user.tenantSlug ?? "—"}
              {user.tenantId && (
                <span className="ml-1 font-mono text-[10px] text-ink-3">({user.tenantId})</span>
              )}
            </dd>
          </div>
        </dl>

        <p className="mt-5 rounded-sm border border-line bg-surface px-3 py-2 font-mono text-[11px] text-ink-3">
          Password changes and role management are handled by your tenant administrator.
        </p>

        <form action="/api/auth/signout" method="POST" className="mt-4">
          <button
            type="submit"
            className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-1.5 font-mono text-[11px] text-danger hover:bg-danger/20"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
