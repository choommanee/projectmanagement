export type Project = {
  id: string; name: string; status: "active" | "planning" | "completed";
  owner: string; due: string; progress: number;
};

export const mockProjects: Project[] = [
  { id: "p-001", name: "Phoenix Migration",        status: "active",    owner: "Alice", due: "2026-06-30", progress: 62 },
  { id: "p-002", name: "Atlas ERP Integration",    status: "active",    owner: "Bob",   due: "2026-08-15", progress: 35 },
  { id: "p-003", name: "Quality Portal Rebuild",   status: "planning",  owner: "Carol", due: "2026-09-01", progress: 5  },
  { id: "p-004", name: "Mobile App v2",            status: "active",    owner: "Dan",   due: "2026-07-20", progress: 78 },
  { id: "p-005", name: "Customer 360",             status: "completed", owner: "Eve",   due: "2026-04-10", progress: 100 },
  { id: "p-006", name: "MES Connector",            status: "active",    owner: "Frank", due: "2026-10-30", progress: 18 },
  { id: "p-007", name: "Tax e-Invoice Compliance", status: "planning",  owner: "Grace", due: "2026-11-15", progress: 0  },
];

export function findProject(id: string) {
  return mockProjects.find((p) => p.id === id);
}
