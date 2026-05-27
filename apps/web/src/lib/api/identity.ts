export interface UserSummary {
  id: string;
  display_name: string;
  email: string;
}

export interface IdentityUser {
  id: string;
  email: string;
  display_name?: string;
  role?: string;
  active?: boolean;
  tenant_id?: string;
}

export async function listUsers(q?: string, limit = 50): Promise<UserSummary[]> {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("limit", String(limit));
  const res = await fetch(`/api/identity/users?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`listUsers: ${res.status}`);
  const data = (await res.json()) as { users: UserSummary[] };
  return data.users;
}

export async function listIdentityUsers(): Promise<IdentityUser[]> {
  const res = await fetch("/api/identity/users?limit=200", { cache: "no-store" });
  if (!res.ok) throw new Error(`listIdentityUsers: ${res.status}`);
  const data = await res.json();
  if (Array.isArray(data)) return data as IdentityUser[];
  if (Array.isArray(data?.users)) return data.users as IdentityUser[];
  return [];
}

export async function getIdentityUser(id: string): Promise<IdentityUser> {
  const res = await fetch(`/api/identity/users/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getIdentityUser: ${res.status}`);
  const data = await res.json();
  return data as IdentityUser;
}
