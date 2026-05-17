export type BOM = { id: string; parent: string; child: string; qty: number; uom: string; level: number };

export const mockBOM: BOM[] = [
  { id: "1", parent: "BRK-ASSY-V2", child: "BRK-FRAME",     qty: 1,   uom: "EA", level: 1 },
  { id: "2", parent: "BRK-FRAME",   child: "STL-PLATE-3mm", qty: 2,   uom: "EA", level: 2 },
  { id: "3", parent: "BRK-FRAME",   child: "BOLT-M8x20",    qty: 8,   uom: "EA", level: 2 },
  { id: "4", parent: "BRK-ASSY-V2", child: "BRK-PAD-X",     qty: 4,   uom: "EA", level: 1 },
  { id: "5", parent: "BRK-ASSY-V2", child: "BRAKE-FLUID",   qty: 0.5, uom: "L",  level: 1 },
];
