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
      <div className="rounded-lg border border-border bg-bg p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-primary text-xl font-semibold text-white">
            {user.displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-semibold">{user.displayName}</h1>
            <p className="text-sm text-fgMuted">{user.email}</p>
          </div>
        </div>

        <dl className="mt-6 space-y-3 text-sm">
          <div className="flex gap-4">
            <dt className="w-32 font-medium text-fgMuted">User ID</dt>
            <dd className="font-mono text-xs">{user.id}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-32 font-medium text-fgMuted">Email</dt>
            <dd>{user.email}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-32 font-medium text-fgMuted">Display name</dt>
            <dd>{user.displayName}</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-32 font-medium text-fgMuted">Tenant</dt>
            <dd>
              {user.tenantSlug}{" "}
              {user.tenantId && (
                <span className="ml-1 font-mono text-xs text-fgMuted">({user.tenantId})</span>
              )}
            </dd>
          </div>
        </dl>

        <p className="mt-6 rounded bg-bgMuted px-3 py-2 text-xs text-fgMuted">
          Phase 2: full profile editor coming soon.
        </p>

        <form action="/api/auth/signout" method="POST" className="mt-4">
          <button
            type="submit"
            className="rounded-md border border-danger/40 bg-danger/10 px-4 py-2 text-sm text-danger hover:bg-danger/20"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
