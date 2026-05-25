"use client";

import { useState, useCallback } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { X, BarChart3, TrendingUp, Table, Hash } from "lucide-react";
import { Button } from "@pmplatform/ui-kit";

export type WidgetType = "kpi" | "bar" | "line" | "table";

export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  dataKey: string;
  value?: string | number;
}

interface DashboardBuilderProps {
  widgets: Widget[];
  onWidgetsChange: (widgets: Widget[]) => void;
}

const WIDGET_ICONS: Record<WidgetType, React.ComponentType<{ size?: number; className?: string }>> = {
  kpi:   Hash,
  bar:   BarChart3,
  line:  TrendingUp,
  table: Table,
};

function WidgetCard({
  widget,
  onRemove,
}: {
  widget: Widget;
  onRemove: () => void;
}) {
  const Icon = WIDGET_ICONS[widget.type];
  return (
    <div className="flex h-full flex-col rounded-md border border-border bg-surface shadow-sm overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 cursor-move widget-drag-handle">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-fgMuted" />
          <span className="text-xs font-medium">{widget.title}</span>
        </div>
        <button
          onClick={onRemove}
          className="text-fgMuted hover:text-danger"
          aria-label={`Remove ${widget.title}`}
        >
          <X size={13} />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center p-3">
        {widget.type === "kpi" ? (
          <div className="text-center">
            <p className="font-mono text-3xl font-bold text-primary">
              {widget.value ?? "—"}
            </p>
            <p className="mt-1 text-xs text-fgMuted">{widget.dataKey}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 text-fgMuted">
            <Icon size={24} />
            <p className="text-xs">Connect data source</p>
          </div>
        )}
      </div>
    </div>
  );
}

const WIDGET_PRESETS: Array<{ type: WidgetType; title: string; dataKey: string }> = [
  { type: "kpi",   title: "Open Tasks",       dataKey: "tasks.open"        },
  { type: "kpi",   title: "In Progress",      dataKey: "tasks.inProgress"  },
  { type: "bar",   title: "Tasks by Sprint",  dataKey: "sprints.tasks"     },
  { type: "line",  title: "Burndown",         dataKey: "sprint.burndown"   },
  { type: "table", title: "Recent Tasks",     dataKey: "tasks.recent"      },
];

export function DashboardBuilder({ widgets, onWidgetsChange }: DashboardBuilderProps) {
  const [layout, setLayout] = useState<Layout[]>(() =>
    widgets.map((w, i) => ({
      i: w.id,
      x: (i % 3) * 4,
      y: Math.floor(i / 3) * 4,
      w: 4,
      h: 4,
    })),
  );

  const addWidget = useCallback(
    (preset: (typeof WIDGET_PRESETS)[0]) => {
      const id = `widget-${Date.now()}`;
      const newWidget: Widget = {
        id,
        ...preset,
        value: preset.type === "kpi" ? Math.floor(Math.random() * 50) : undefined,
      };
      const col = widgets.length % 3;
      const row = Math.floor(widgets.length / 3);
      setLayout((prev) => [...prev, { i: id, x: col * 4, y: row * 4, w: 4, h: 4 }]);
      onWidgetsChange([...widgets, newWidget]);
    },
    [widgets, onWidgetsChange],
  );

  const removeWidget = useCallback(
    (id: string) => {
      setLayout((prev) => prev.filter((l) => l.i !== id));
      onWidgetsChange(widgets.filter((w) => w.id !== id));
    },
    [widgets, onWidgetsChange],
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Widget palette */}
      <div className="flex flex-wrap gap-2 rounded-md border border-border bg-surface-2 p-3">
        <span className="self-center text-xs font-medium text-fgMuted mr-2">
          Add widget:
        </span>
        {WIDGET_PRESETS.map((p) => {
          const Icon = WIDGET_ICONS[p.type];
          return (
            <Button key={p.dataKey} size="sm" variant="ghost" onClick={() => addWidget(p)}>
              <Icon size={13} className="mr-1" />
              {p.title}
            </Button>
          );
        })}
      </div>

      {/* Grid canvas */}
      {widgets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-16 text-fgMuted">
          <BarChart3 size={32} />
          <p className="text-sm">Add widgets from the palette above</p>
        </div>
      ) : (
        <GridLayout
          className="layout"
          layout={layout}
          cols={12}
          rowHeight={60}
          width={960}
          onLayoutChange={setLayout}
          draggableHandle=".widget-drag-handle"
        >
          {widgets.map((w) => (
            <div key={w.id}>
              <WidgetCard widget={w} onRemove={() => removeWidget(w.id)} />
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  );
}
