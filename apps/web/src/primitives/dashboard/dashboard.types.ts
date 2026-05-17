export interface WidgetDef {
  id: string;
  kind: "kpi" | "chart" | "list" | "iframe";
  title?: string;
  x: number; y: number; w: number; h: number;
  config: Record<string, unknown>;
}

export interface DashboardDef {
  id: string;
  name: string;
  cols?: number;
  widgets: WidgetDef[];
}
