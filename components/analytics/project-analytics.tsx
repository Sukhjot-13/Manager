"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Loader2, Play, RefreshCw, Square } from "lucide-react";
import { PermissionGate } from "@/components/permission-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import {
  DeviceBreakdown,
  RankingCard,
  StatTile,
  UtmCard,
} from "@/components/analytics/breakdown";
import { TrafficChart } from "@/components/analytics/traffic-chart";
import type { AnalyticsSummary } from "@/lib/analytics";

const RANGES = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "custom", label: "Custom" },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

const LIVE_INTERVAL_MS = 5000;

function errorMessage(payload: unknown, fallback: string): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as { error: unknown }).error === "string"
  ) {
    return (payload as { error: string }).error;
  }
  return fallback;
}

function isoDay(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return date.toISOString().slice(0, 10);
}

export function ProjectAnalytics({
  projectSlug,
  initial,
  initialAnalyticsEnabled,
}: {
  projectSlug: string;
  initial: AnalyticsSummary;
  initialAnalyticsEnabled: boolean;
}) {
  const { push } = useToast();
  const base = `/api/projects/${projectSlug}/analytics`;
  const [summary, setSummary] = useState<AnalyticsSummary>(initial);
  const [range, setRange] = useState<RangeId>(
    RANGES.some((entry) => entry.id === initial.range) ? (initial.range as RangeId) : "7d",
  );
  const [from, setFrom] = useState(isoDay(-6));
  const [to, setTo] = useState(isoDay(0));
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [enabled, setEnabled] = useState(initialAnalyticsEnabled);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(
    async (nextRange: RangeId, nextFrom: string, nextTo: string): Promise<void> => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("range", nextRange);
        if (nextRange === "custom") {
          if (nextFrom === "" || nextTo === "") {
            push("pick a start and end date", "error");
            return;
          }
          params.set("from", nextFrom);
          params.set("to", nextTo);
        }
        const response = await fetch(`${base}?${params.toString()}`, { cache: "no-store" });
        const payload: unknown = await response.json();
        if (!response.ok) {
          push(errorMessage(payload, "could not load analytics"), "error");
          return;
        }
        setSummary(payload as AnalyticsSummary);
      } catch {
        push("could not load analytics", "error");
      } finally {
        setLoading(false);
      }
    },
    [base, push],
  );

  const apply = useCallback(
    (nextRange: RangeId, nextFrom: string, nextTo: string): void => {
      setRange(nextRange);
      void load(nextRange, nextFrom, nextTo);
    },
    [load],
  );

  useEffect(() => {
    if (!live) {
      return;
    }
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const response = await fetch(`${base}?range=${summary.range}`, { cache: "no-store" });
        if (!response.ok || cancelled) {
          return;
        }
        const payload = (await response.json()) as AnalyticsSummary;
        if (cancelled) {
          return;
        }
        setSummary(payload);
      } catch {
        void 0;
      }
    };
    const timer = setInterval(() => {
      void poll();
    }, LIVE_INTERVAL_MS);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [base, live, summary.range]);

  const exportRows = useCallback(
    async (format: "csv" | "json"): Promise<void> => {
      try {
        const params = new URLSearchParams();
        params.set("format", format);
        params.set("range", range);
        if (range === "custom") {
          params.set("from", from);
          params.set("to", to);
        }
        const response = await fetch(`${base}/export?${params.toString()}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          const payload: unknown = await response.json().catch(() => null);
          push(errorMessage(payload, "export failed"), "error");
          return;
        }
        const text = await response.text();
        const blob = new Blob([text], {
          type: format === "json" ? "application/json" : "text/csv",
        });
        const href = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = `${projectSlug}-events.${format}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(href);
        push(`exported ${response.headers.get("x-row-count") ?? "0"} events`, "success");
      } catch {
        push("export failed", "error");
      }
    },
    [base, from, projectSlug, push, range, to],
  );

  const toggleIngest = useCallback(async (): Promise<void> => {
    setToggling(true);
    try {
      const response = await fetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyticsEnabled: !enabled }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        push(errorMessage(payload, "could not change the setting"), "error");
        return;
      }
      const next = (payload as { analyticsEnabled: boolean }).analyticsEnabled;
      setEnabled(next);
      push(`analytics ingest ${next ? "enabled" : "disabled"}`, "success");
    } catch {
      push("could not change the setting", "error");
    } finally {
      setToggling(false);
    }
  }, [base, enabled, push]);

  const rangeLabel = useMemo(() => {
    const start = new Date(summary.from);
    const end = new Date(summary.to);
    const fmt = (date: Date): string =>
      Number.isNaN(date.getTime())
        ? "—"
        : date.toISOString().slice(0, 10);
    return `${fmt(start)} → ${fmt(end)} · ${summary.days} days · ${summary.timezone}`;
  }, [summary]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          {RANGES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={range === entry.id}
              onClick={() => apply(entry.id, from, to)}
              className={
                range === entry.id
                  ? "bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }
            >
              {entry.label}
            </button>
          ))}
        </div>
        {range === "custom" ? (
          <div className="flex items-end gap-2">
            <Field label="From" htmlFor="analytics-from">
              <Input
                id="analytics-from"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </Field>
            <Field label="To" htmlFor="analytics-to">
              <Input
                id="analytics-to"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </Field>
            <Button variant="outline" size="sm" onClick={() => apply("custom", from, to)}>
              Apply
            </Button>
          </div>
        ) : null}
        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={live}
            onChange={(event) => setLive(event.target.checked)}
          />
          {live ? <Play size={14} /> : <Square size={14} />}
          Live active-now
        </label>
        <div className="ml-auto flex items-center gap-2">
          <PermissionGate permission="analytics.edit">
            <Button variant="outline" size="sm" onClick={() => void exportRows("csv")}>
              <Download size={14} />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => void exportRows("json")}>
              <Download size={14} />
              JSON
            </Button>
          </PermissionGate>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void apply(range, from, to)}
            disabled={loading}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <Badge tone={enabled ? "green" : "red"}>ingest {enabled ? "on" : "off"}</Badge>
        <span>{rangeLabel}</span>
        <span>· rollups recomputed on read for today</span>
        <PermissionGate permission="analytics.edit">
          <Button
            variant={enabled ? "ghost" : "primary"}
            size="sm"
            className="ml-auto"
            disabled={toggling}
            onClick={() => void toggleIngest()}
          >
            {enabled ? "Disable analytics ingest" : "Enable analytics ingest"}
          </Button>
        </PermissionGate>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Visitors" value={summary.totals.visitors} hint="unique in range" />
        <StatTile label="Pageviews" value={summary.totals.pageviews} />
        <StatTile label="Clicks" value={summary.totals.clicks} />
        <StatTile label="Custom events" value={summary.totals.customEvents} />
        <StatTile
          label="Active now"
          value={summary.totals.activeNow}
          hint={`last ${summary.activeWindowMinutes} min`}
          accent={summary.totals.activeNow > 0}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Traffic</CardTitle>
          <span className="text-xs text-zinc-500">daily UTC buckets</span>
        </CardHeader>
        <CardContent>
          <TrafficChart
            series={summary.series}
            timeZone={summary.timezone}
            height={280}
            showClicks={summary.totals.clicks > 0}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <RankingCard
          title="Top pages"
          rows={summary.topPages}
          total={summary.totals.pageviews}
          empty="No pageviews in this range."
          columns={["Path", "Views", "Share"]}
        />
        <RankingCard
          title="Entry pages"
          rows={summary.entryPages}
          total={summary.totals.visitors}
          empty="No entry pages in this range."
          columns={["Path", "Entries", "Share"]}
        />
        <RankingCard
          title="Top clicked elements"
          rows={summary.clicks}
          total={summary.totals.clicks}
          empty="No clicks captured yet."
          columns={["[path] text (selector)", "Clicks"]}
        />
        <RankingCard
          title="Custom events"
          rows={summary.customEvents}
          total={summary.totals.customEvents}
          empty="No custom events yet."
          columns={["Event", "Hits"]}
        />
        <RankingCard
          title="Referrers"
          rows={summary.referrers}
          total={summary.totals.pageviews}
          empty="No referrers recorded."
          columns={["Referrer", "Hits"]}
        />
        <RankingCard
          title="Sources (utm)"
          rows={summary.sources}
          total={summary.totals.pageviews}
          empty="No utm sources recorded."
          columns={["utm_source", "Hits"]}
        />
        <DeviceBreakdown
          title="Devices"
          rows={summary.devices}
          empty="No device data yet."
        />
        <DeviceBreakdown
          title="Browsers"
          rows={summary.browsers}
          empty="No browser data yet."
        />
        <DeviceBreakdown title="Operating systems" rows={summary.os} empty="No OS data yet." />
        <DeviceBreakdown
          title="Countries"
          rows={summary.countries}
          empty="No country data (needs x-vercel-ip-country)."
        />
        <UtmCard rows={summary.utm} />
      </div>
    </div>
  );
}
