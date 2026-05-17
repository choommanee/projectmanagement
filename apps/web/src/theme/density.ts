export type Density = "compact" | "cozy" | "comfortable";

export const densityPaddingY: Record<Density, string> = {
  compact:     "py-0.5",
  cozy:        "py-1",
  comfortable: "py-2",
};
