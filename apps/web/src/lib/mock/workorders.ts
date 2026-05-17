export type WO = {
  id: string; item: string; qty: number;
  status: "planned" | "released" | "in_progress" | "completed";
  workCenter: string; due: string; priority: "low" | "med" | "high";
};

export const mockWOs: WO[] = [
  { id: "WO-2026-00420", item: "BRK-ASSY-V1", qty: 200,  status: "completed",  workCenter: "WC-WLD-01",   due: "2026-05-10", priority: "med"  },
  { id: "WO-2026-00421", item: "BRK-ASSY-V2", qty: 500,  status: "released",   workCenter: "WC-WLD-03",   due: "2026-06-01", priority: "high" },
  { id: "WO-2026-00422", item: "BRK-ASSY-V2", qty: 300,  status: "in_progress",workCenter: "WC-WLD-03",   due: "2026-06-15", priority: "high" },
  { id: "WO-2026-00423", item: "GEAR-A-01",   qty: 1000, status: "released",   workCenter: "WC-CUT-02",   due: "2026-06-20", priority: "med"  },
  { id: "WO-2026-00424", item: "SHFT-12",     qty: 80,   status: "planned",    workCenter: "WC-CUT-01",   due: "2026-07-01", priority: "low"  },
  { id: "WO-2026-00425", item: "BRK-PAD-X",   qty: 2000, status: "planned",    workCenter: "WC-PRESS-01", due: "2026-07-10", priority: "med"  },
];

export function findWO(id: string) { return mockWOs.find((w) => w.id === id); }
