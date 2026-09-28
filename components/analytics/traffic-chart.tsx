"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SeriesPoint } from "@/lib/analytics";

const noopSubscribe = (): (() => void) => () => {};

function useIsHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function dayLabel(date: string, timeZone: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone,
    }).format(parsed);
  } catch {
    return date;
  }
}

export function TrafficChart({
  series,
  timeZone,
  height = 260,
  showClicks = false,
}: {
  series: SeriesPoint[];
  timeZone: string;
  height?: number;
  showClicks?: boolean;
}) {
  const mounted = useIsHydrated();

  const data = useMemo(
    () =>
      series.map((point) => ({
        label: dayLabel(point.date, timeZone),
        pageviews: point.pageviews,
        visitors: point.visitors,
        clicks: point.clicks,
        customEvents: point.customEvents,
      })),
    [series, timeZone],
  );

  if (!mounted) {
    return (
      <div
        className="w-full animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-900"
        style={{ height }}
      />
    );
  }

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.5} />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid rgb(212 212 216)",
              background: "rgb(255 255 255)",
              color: "rgb(24 24 27)",
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area
            type="monotone"
            dataKey="pageviews"
            name="Pageviews"
            stroke="#0ea5e9"
            fill="#0ea5e9"
            fillOpacity={0.18}
          />
          <Line
            type="monotone"
            dataKey="visitors"
            name="Visitors"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={false}
          />
          {showClicks ? (
            <Line
              type="monotone"
              dataKey="clicks"
              name="Clicks"
              stroke="#8b5cf6"
              strokeWidth={2}
              dot={false}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
