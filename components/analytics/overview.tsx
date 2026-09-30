"use client";

import { useState } from "react";
import { NavigationLink as Link } from "@/components/ui/navigation-link";
import { ArrowRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/analytics/breakdown";
import { TrafficChart } from "@/components/analytics/traffic-chart";
import type { ProjectTotals } from "@/lib/analytics";

const RANGES = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
] as const;

export function AnalyticsOverview({ initial }: { initial: ProjectTotals }) {
  const [data, setData] = useState<ProjectTotals>(initial);
  const [loading, setLoading] = useState(false);

  const apply = async (range: string): Promise<void> => {
    setLoading(true);
    try {
      const response = await fetch(`/api/analytics?range=${range}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        return;
      }
      setData((await response.json()) as ProjectTotals);
    } catch {
      void 0;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          {RANGES.map((entry) => (
            <Button
              key={entry.id}
              variant="ghost"
              size="sm"
              className={
                data.range === entry.id
                  ? "rounded-none bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "rounded-none"
              }
              onClick={() => void apply(entry.id)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
        <span className="text-xs text-zinc-500">
          UTC rollups · display timezone {data.timezone}
        </span>
        {loading ? <Loader2 size={14} className="animate-spin" /> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Pageviews" value={data.totals.pageviews} />
        <StatTile label="Visitors" value={data.totals.visitors} hint="sum of daily uniques" />
        <StatTile label="Clicks" value={data.totals.clicks} />
        <StatTile label="Custom events" value={data.totals.customEvents} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All projects combined</CardTitle>
          <span className="text-xs text-zinc-500">daily pageviews and visitors</span>
        </CardHeader>
        <CardContent>
          <TrafficChart series={data.series} timeZone={data.timezone} height={300} />
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.projects.map((project) => (
          <Card key={project.id}>
            <CardHeader>
              <span aria-hidden className="text-xl">
                {project.emoji}
              </span>
              <div className="min-w-0">
                <CardTitle className="truncate">{project.name}</CardTitle>
                <span className="text-xs text-zinc-500">{project.slug}</span>
              </div>
              <Badge tone={project.analyticsEnabled ? "green" : "red"}>
                {project.analyticsEnabled ? "on" : "off"}
              </Badge>            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-4 gap-2 text-center text-xs">
                <div>
                  <dt className="text-zinc-500">Views</dt>
                  <dd className="text-base font-semibold tabular-nums">{project.pageviews}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Visitors</dt>
                  <dd className="text-base font-semibold tabular-nums">{project.visitors}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Clicks</dt>
                  <dd className="text-base font-semibold tabular-nums">{project.clicks}</dd>
                </div>
                <div>
                  <dt className="text-zinc-500">Events</dt>
                  <dd className="text-base font-semibold tabular-nums">{project.customEvents}</dd>
                </div>
              </dl>
              <Link
                href={`/projects/${project.slug}/analytics`}
                className="mt-3 inline-flex items-center gap-1 text-xs text-sky-600 hover:underline dark:text-sky-400"
              >
                Open analytics
                <ArrowRight size={12} />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
