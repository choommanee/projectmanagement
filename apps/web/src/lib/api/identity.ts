export interface UserSummary {
  id: string;
  display_name: string;
  email: string;
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
