"use client";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import type { DashboardDef, WidgetDef } from "./dashboard.types";
import { KpiTile }     from "./widgets/KpiTile";
import { ChartWidget } from "./widgets/ChartWidget";
import { ListWidget }  from "./widgets/ListWidget";
import { IframeWidget } from "./widgets/IframeWidget";

const COLS = 12;
const ROW_HEIGHT = 60;

export function DashboardGrid({ def, onLayoutChange }: { def: DashboardDef; onLayoutChange?: (l: Layout[]) => void }) {
  const layout: Layout[] = def.widgets.map((w) => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h }));
  return (
    <GridLayout
      className="layout"
      layout={layout}
      cols={def.cols ?? COLS}
      rowHeight={ROW_HEIGHT}
      width={1200}
      isResizable
      isDraggable
      onLayoutChange={(l) => onLayoutChange?.(l)}
    >
      {def.widgets.map((w) => (
        <div key={w.id} data-grid={{ x: w.x, y: w.y, w: w.w, h: w.h }}>
          <Widget def={w} />
        </div>
      ))}
    </GridLayout>
  );
}

function Widget({ def }: { def: WidgetDef }) {
  switch (def.kind) {
    case "kpi":    return <KpiTile     title={String(def.config.title)} value={String(def.config.value)} sub={def.config.sub as string | undefined} />;
    case "chart":  return <ChartWidget title={def.config.title as string | undefined} />;
    case "list":   return <ListWidget  title={def.config.title as string | undefined} items={(def.config.items as { label: string }[]) ?? []} />;
    case "iframe": return <IframeWidget src={String(def.config.src)} title={def.config.title as string | undefined} />;
  }
}
