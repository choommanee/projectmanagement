"use client";

export interface KpiWidgetProps {
  title: string;
  value: string | number;
  unit?: string;
  trend?: number;  // positive = up, negative = down
  loading?: boolean;
}

export function KpiWidget({ title, value, unit, trend, loading }: KpiWidgetProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface p-4">
        <div className="h-3 w-24 animate-pulse rounded-xs bg-surface-2" />
        <div className="h-8 w-32 animate-pulse rounded-xs bg-surface-2" />
        <div className="h-3 w-16 animate-pulse rounded-xs bg-surface-2" />
      </div>
    );
  }

  const trendPositive = trend !== undefined && trend > 0;
  const trendNegative = trend !== undefined && trend < 0;
  const trendNeutral  = trend !== undefined && trend === 0;

  return (
    <div className="flex flex-col gap-1 rounded-sm border border-line bg-surface p-4">
      {/* Label */}
      <span className="text-xs font-medium uppercase tracking-wider text-ink-3">
        {title}
      </span>

      {/* Big number */}
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-3xl font-bold tabular-nums leading-none text-ink">
          {value}
        </span>
        {unit && (
          <span className="font-mono text-sm text-ink-3">{unit}</span>
        )}
      </div>

      {/* Trend */}
      {trend !== undefined && (
        <div
          className={`flex items-center gap-1 text-xs font-medium ${
            trendPositive
              ? "text-success"
              : trendNegative
              ? "text-danger"
              : "text-ink-3"
          }`}
        >
          {trendPositive && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M5 1L9 9H1L5 1Z" fill="currentColor" />
            </svg>
          )}
          {trendNegative && (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M5 9L9 1H1L5 9Z" fill="currentColor" />
            </svg>
          )}
          {trendNeutral && (
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
              <path d="M0 3H10" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          )}
          <span>
            {trendPositive && "+"}
            {Math.abs(trend)}%
          </span>
        </div>
      )}
    </div>
  );
}
