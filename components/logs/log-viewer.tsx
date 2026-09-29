"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Download,
  Filter,
  Layers,
  Loader2,
  Play,
  Search,
  Square,
  X,
} from "lucide-react";
import { PermissionGate } from "@/components/permission-gate";
import { Badge, LEVEL_TONE } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { LogGroup, SerializedLog } from "@/lib/ingest";
import { chronologicalLogs } from "@/lib/logTimeline";

const LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
type Level = (typeof LEVELS)[number];
type SourceTab = "all" | "server" | "client";

const TABS: { id: SourceTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "server", label: "Server" },
  { id: "client", label: "Client" },
];

const PAGE_SIZE = 50;
const LIVE_INTERVAL_MS = 4000;
const BOTTOM_TOLERANCE = 48;

const CONTEXT_FIELDS: { key: keyof SerializedLog; label: string }[] = [
  { key: "source", label: "source" },
  { key: "environment", label: "environment" },
  { key: "release", label: "release" },
  { key: "appVersion", label: "appVersion" },
  { key: "keyPrefix", label: "key prefix" },
  { key: "sessionId", label: "sessionId" },
  { key: "pageId", label: "pageId" },
  { key: "traceId", label: "traceId" },
  { key: "requestId", label: "requestId" },
  { key: "route", label: "route" },
  { key: "url", label: "url" },
  { key: "referrer", label: "referrer" },
  { key: "durationMs", label: "durationMs" },
  { key: "browser", label: "browser" },
  { key: "os", label: "os" },
  { key: "device", label: "device" },
  { key: "viewport", label: "viewport" },
  { key: "lang", label: "lang" },
  { key: "tz", label: "timezone" },
  { key: "connection", label: "connection" },
  { key: "ua", label: "user agent" },
  { key: "hostname", label: "hostname" },
  { key: "pid", label: "pid" },
  { key: "runtimeVersion", label: "runtime" },
  { key: "rssMb", label: "rssMb" },
  { key: "uptimeSec", label: "uptimeSec" },
  { key: "ip", label: "ip" },
  { key: "country", label: "country" },
  { key: "fingerprint", label: "fingerprint" },
  { key: "count", label: "occurrences" },
];

type FilterState = {
  source: SourceTab;
  levels: Level[];
  environment: string;
  release: string;
  search: string;
  sessionId: string;
  traceId: string;
  since: string;
  until: string;
};

const EMPTY_FILTERS: FilterState = {
  source: "all",
  levels: [],
  environment: "",
  release: "",
  search: "",
  sessionId: "",
  traceId: "",
  since: "",
  until: "",
};

function toIso(value: string): string | undefined {
  if (value.trim() === "") {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function buildQuery(
  filters: FilterState,
  options: { cursor?: string | null; group?: boolean; limit?: number } = {},
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.source !== "all") {
    params.set("source", filters.source);
  }
  if (filters.levels.length > 0) {
    params.set("levels", filters.levels.join(","));
  }
  if (filters.environment !== "") {
    params.set("environment", filters.environment);
  }
  if (filters.release !== "") {
    params.set("release", filters.release);
  }
  if (filters.search.trim() !== "") {
    params.set("search", filters.search.trim());
  }
  if (filters.sessionId.trim() !== "") {
    params.set("sessionId", filters.sessionId.trim());
  }
  if (filters.traceId.trim() !== "") {
    params.set("traceId", filters.traceId.trim());
  }
  const since = toIso(filters.since);
  if (since !== undefined) {
    params.set("since", since);
  }
  const until = toIso(filters.until);
  if (until !== undefined) {
    params.set("until", until);
  }
  if (options.group === true) {
    params.set("group", "1");
  }
  if (options.cursor !== undefined && options.cursor !== null && options.cursor !== "") {
    params.set("cursor", options.cursor);
  }
  params.set("limit", String(options.limit ?? PAGE_SIZE));
  return params;
}

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

function timeOf(value: string): string {
  if (value === "") {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function clockOf(value: string): string {
  if (value === "") {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return `${date.toLocaleTimeString()}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function sortRows(rows: SerializedLog[]): SerializedLog[] {
  return [...rows].sort((a, b) => {
    if (a.ts === b.ts) {
      return a.id < b.id ? 1 : -1;
    }
    return a.ts < b.ts ? 1 : -1;
  });
}

function mergeRows(head: SerializedLog[], tail: SerializedLog[]): SerializedLog[] {
  const seen = new Set<string>();
  const merged: SerializedLog[] = [];
  for (const row of [...head, ...tail]) {
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    merged.push(row);
  }
  return sortRows(merged);
}

function Sparkline({ buckets }: { buckets: { hour: string; count: number }[] }) {
  if (buckets.length === 0) {
    return <span className="text-xs text-zinc-400">no trend</span>;
  }
  const max = Math.max(...buckets.map((bucket) => bucket.count), 1);
  return (
    <span className="flex h-6 items-end gap-px" aria-hidden>
      {buckets.map((bucket) => (
        <span
          key={bucket.hour}
          title={`${timeOf(bucket.hour)} · ${bucket.count}`}
          className="w-1.5 rounded-sm bg-amber-500/70"
          style={{ height: `${Math.max(2, Math.round((bucket.count / max) * 24))}px` }}
        />
      ))}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  return (
    <span title={source} aria-label={source} className="text-xs">
      {source === "server" ? "🖥" : "💻"}
    </span>
  );
}

export function LogViewer({
  projectSlug,
  initialLogs,
  initialCursor,
  initialHasMore,
  initialTotal,
  initialGroups,
  environments,
  releases,
}: {
  projectSlug: string;
  initialLogs: SerializedLog[];
  initialCursor: string | null;
  initialHasMore: boolean;
  initialTotal: number;
  initialGroups: LogGroup[];
  environments: string[];
  releases: string[];
}) {
  const { push } = useToast();
  const base = `/api/projects/${projectSlug}/logs`;
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<FilterState>(EMPTY_FILTERS);
  const [rows, setRows] = useState<SerializedLog[]>(initialLogs);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [total, setTotal] = useState(initialTotal);
  const [groups, setGroups] = useState<LogGroup[]>(initialGroups);
  const [grouped, setGrouped] = useState(false);
  const [selected, setSelected] = useState<SerializedLog | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [samples, setSamples] = useState<Record<string, SerializedLog[]>>({});
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [live, setLive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const together = filters.traceId.trim() !== "";
  const displayRows = useMemo(() => together ? chronologicalLogs(rows) : rows, [rows, together]);

  const runQuery = useCallback(
    async (next: FilterState, group: boolean): Promise<void> => {
      setLoading(true);
      try {
        const response = await fetch(
          `${base}?${buildQuery(next, { group }).toString()}`,
          { cache: "no-store" },
        );
        const payload: unknown = await response.json();
        if (!response.ok) {
          push(errorMessage(payload, "could not load logs"), "error");
          return;
        }
        if (group) {
          setGroups((payload as { groups: LogGroup[] }).groups);
          return;
        }
        const page = payload as {
          logs: SerializedLog[];
          nextCursor: string | null;
          hasMore: boolean;
          total: number;
        };
        setRows(page.logs);
        setCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setTotal(page.total);
        setPaused(false);
      } catch {
        push("could not load logs", "error");
      } finally {
        setLoading(false);
      }
    },
    [base, push],
  );

  const apply = useCallback(
    (next: FilterState) => {
      setFilters(next);
      setDraft(next);
      setSamples({});
      setExpanded(null);
      void runQuery(next, grouped);
    },
    [grouped, runQuery],
  );

  const loadMore = useCallback(async (): Promise<void> => {
    if (cursor === null) {
      return;
    }
    setLoadingMore(true);
    try {
      const response = await fetch(
        `${base}?${buildQuery(filters, { cursor }).toString()}`,
        { cache: "no-store" },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        push(errorMessage(payload, "could not load more logs"), "error");
        return;
      }
      const page = payload as { logs: SerializedLog[]; nextCursor: string | null; hasMore: boolean };
      setRows((current) => mergeRows(current, page.logs));
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch {
      push("could not load more logs", "error");
    } finally {
      setLoadingMore(false);
    }
  }, [base, cursor, filters, push]);

  const poll = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch(
        `${base}?${buildQuery(filters).toString()}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as {
        logs: SerializedLog[];
        nextCursor: string | null;
        hasMore: boolean;
        total: number;
      };
      setRows((current) => mergeRows(payload.logs, current));
      setTotal(payload.total);
    } catch {
      void 0;
    }
  }, [base, filters]);

  useEffect(() => {
    if (!live || paused || grouped) {
      return;
    }
    const timer = setInterval(() => {
      void poll();
    }, LIVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [grouped, live, paused, poll]);

  const onScroll = useCallback(() => {
    const node = listRef.current;
    if (node === null) {
      return;
    }
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    setPaused(distance > BOTTOM_TOLERANCE);
  }, []);

  const openGroup = useCallback(
    async (fingerprint: string): Promise<void> => {
      if (expanded === fingerprint) {
        setExpanded(null);
        return;
      }
      setExpanded(fingerprint);
      if (samples[fingerprint] !== undefined) {
        return;
      }
      try {
        const params = new URLSearchParams(
          buildQuery({ ...filters, source: "all" }, { limit: 20 }).toString(),
        );
        params.set("source", "all");
        params.set("fingerprint", fingerprint);
        const response = await fetch(`${base}?${params.toString()}`, {
          cache: "no-store",
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
          return;
        }
        setSamples((current) => ({
          ...current,
          [fingerprint]: (payload as { logs: SerializedLog[] }).logs.slice(0, 20),
        }));
      } catch {
        void 0;
      }
    },
    [base, expanded, filters, samples],
  );

  const exportRows = useCallback(
    async (format: "csv" | "json"): Promise<void> => {
      try {
        const params = buildQuery(filters, { limit: PAGE_SIZE });
        params.set("format", format);
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
        anchor.download = `${projectSlug}-logs.${format}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(href);
        push(`exported ${response.headers.get("x-row-count") ?? "0"} rows`, "success");
      } catch {
        push("export failed", "error");
      }
    },
    [base, filters, projectSlug, push],
  );

  const copyJson = useCallback(
    async (value: unknown): Promise<void> => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
        push("log JSON copied", "success");
      } catch {
        push("clipboard write failed", "error");
      }
    },
    [push],
  );

  const deepLink = useCallback(
    (log: SerializedLog): void => {
      const url = new URL(window.location.href);
      url.searchParams.set("log", log.id);
      window.history.replaceState(null, "", url.toString());
    },
    [],
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.source !== "all") {
      count += 1;
    }
    count += filters.levels.length;
    if (filters.environment !== "") {
      count += 1;
    }
    if (filters.release !== "") {
      count += 1;
    }
    if (filters.search.trim() !== "") {
      count += 1;
    }
    if (filters.sessionId.trim() !== "") {
      count += 1;
    }
    if (filters.traceId.trim() !== "") {
      count += 1;
    }
    if (filters.since !== "" || filters.until !== "") {
      count += 1;
    }
    return count;
  }, [filters]);

  const stackLines = selected === null ? [] : selected.stack.split("\n").filter((line) => line.trim() !== "");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={filters.source === tab.id}
              onClick={() => apply({ ...filters, source: tab.id })}
              className={
                filters.source === tab.id
                  ? "bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowFilters((value) => !value)}
        >
          <Filter size={14} />
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </Button>
        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={grouped}
            onChange={(event) => {
              const next = event.target.checked;
              setGrouped(next);
              void runQuery(filters, next);
            }}
          />
          <Layers size={14} />
          Group errors
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={live}
            onChange={(event) => {
              setLive(event.target.checked);
              setPaused(false);
            }}
          />
          {live ? <Play size={14} /> : <Square size={14} />}
          Live tail
        </label>
        <div className="ml-auto flex items-center gap-2">
          <PermissionGate permission="logs.export">
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
            onClick={() => {
              setRows([]);
              setCursor(null);
              void runQuery(filters, grouped);
            }}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : null}
            Refresh
          </Button>
        </div>
      </div>

      {showFilters ? (
        <Card>
          <CardContent className="space-y-3 pt-4">
            <div className="flex flex-wrap gap-1">
              {LEVELS.map((level) => {
                const on = filters.levels.includes(level);
                return (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      apply({
                        ...filters,
                        levels: on
                          ? filters.levels.filter((entry) => entry !== level)
                          : [...filters.levels, level],
                      })
                    }
                    className={
                      on
                        ? "rounded-full px-2 py-0.5 text-xs font-medium ring-2 ring-zinc-900 dark:ring-zinc-50"
                        : "opacity-60 hover:opacity-100"
                    }
                  >
                    <Badge tone={LEVEL_TONE[level]}>{level}</Badge>
                  </button>
                );
              })}
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label="Environment" htmlFor="log-environment">
                <Select
                  id="log-environment"
                  value={draft.environment}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, environment: event.target.value }))
                  }
                >
                  <option value="">any</option>
                  {environments.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Release" htmlFor="log-release">
                <Select
                  id="log-release"
                  value={draft.release}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, release: event.target.value }))
                  }
                >
                  <option value="">any</option>
                  {releases.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="From" htmlFor="log-since">
                <Input
                  id="log-since"
                  type="datetime-local"
                  value={draft.since}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, since: event.target.value }))
                  }
                />
              </Field>
              <Field label="To" htmlFor="log-until">
                <Input
                  id="log-until"
                  type="datetime-local"
                  value={draft.until}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, until: event.target.value }))
                  }
                />
              </Field>
              <Field label="Search" htmlFor="log-search">
                <Input
                  id="log-search"
                  value={draft.search}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, search: event.target.value }))
                  }
                  placeholder="message, stack, route…"
                />
              </Field>
              <Field label="Session id" htmlFor="log-session">
                <Input
                  id="log-session"
                  value={draft.sessionId}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, sessionId: event.target.value }))
                  }
                />
              </Field>
              <Field label="Trace id" htmlFor="log-trace">
                <Input
                  id="log-trace"
                  value={draft.traceId}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, traceId: event.target.value }))
                  }
                />
              </Field>
              <div className="flex items-end gap-2">
                <Button onClick={() => apply(draft)}>
                  <Search size={14} />
                  Apply
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft(EMPTY_FILTERS);
                    apply(EMPTY_FILTERS);
                  }}
                >
                  Clear
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {live && paused ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Live tail paused — you scrolled up.
          <button
            type="button"
            className="underline"
            onClick={() => {
              const node = listRef.current;
              if (node !== null) {
                node.scrollTop = node.scrollHeight;
              }
              setPaused(false);
            }}
          >
            Resume
          </button>
        </div>
      ) : null}

      {grouped ? (
        <Card>
          <CardHeader>
            <CardTitle>Error groups</CardTitle>
            <span className="text-xs text-zinc-500">
              {groups.length} fingerprints · newest last-seen first
            </span>
          </CardHeader>
          <CardContent className="space-y-2">
            {groups.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500">
                No grouped errors for this filter.
              </p>
            ) : null}
            {groups.map((group) => (
              <div
                key={group.fingerprint}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800"
              >
                <button
                  type="button"
                  onClick={() => void openGroup(group.fingerprint)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <Badge tone={LEVEL_TONE[group.level] ?? "red"}>{group.level}</Badge>
                  <SourceBadge source={group.source} />
                  <span className="min-w-0 flex-1 truncate text-xs font-mono">
                    {group.message}
                  </span>
                  <Badge tone="red">×{group.count}</Badge>
                  <Sparkline buckets={group.buckets} />
                  <span className="hidden text-[10px] text-zinc-400 sm:inline">
                    {timeOf(group.firstSeen)} → {timeOf(group.lastSeen)}
                  </span>
                </button>
                {expanded === group.fingerprint ? (
                  <div className="space-y-1 border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
                    <p className="text-[10px] text-zinc-400">
                      fingerprint {group.fingerprint}
                    </p>
                    {(samples[group.fingerprint] ?? []).map((sample) => (
                      <button
                        key={sample.id}
                        type="button"
                        onClick={() => {
                          setSelected(sample);
                          deepLink(sample);
                        }}
                        className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900"
                      >
                        <span className="text-zinc-400">{clockOf(sample.ts)}</span>
                        <SourceBadge source={sample.source} />
                        <span className="truncate font-mono">{sample.message}</span>
                      </button>
                    ))}
                    {(samples[group.fingerprint] ?? []).length === 0 ? (
                      <p className="text-xs text-zinc-500">loading samples…</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {!grouped ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {together ? "Trace timeline" : "Logs"}
              {together ? ` · ${filters.traceId.trim()}` : ""}
            </CardTitle>
            <span className="text-xs text-zinc-500">
              {rows.length} shown · {total} matching
              {together ? " · client and server merged" : ""}
            </span>
            {together ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => apply({ ...filters, source: "all", traceId: "" })}
              >
                <X size={14} />
                Exit trace
              </Button>
            ) : null}
          </CardHeader>
          <CardContent>
            <div
              ref={listRef}
              onScroll={onScroll}
              className="max-h-[32rem] overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800"
            >
              {rows.length === 0 ? (
                <p className="py-10 text-center text-sm text-zinc-500">
                  No logs match these filters yet.
                </p>
              ) : null}
              {displayRows.map((row, index) => {
                const previous = displayRows[index - 1];
                const gap =
                  previous === undefined
                    ? 0
                    : new Date(row.ts).getTime() - new Date(previous.ts).getTime();
                return (
                  <div key={row.id}>
                    {together && previous !== undefined ? (
                      <p className="bg-zinc-50 px-3 py-0.5 text-[10px] text-zinc-400 dark:bg-zinc-900/40">
                        +{gap}ms
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(row);
                        deepLink(row);
                      }}
                      className="flex w-full items-center gap-2 border-b border-zinc-100 px-3 py-1.5 text-left last:border-b-0 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900"
                    >
                      <span className="w-20 shrink-0 font-mono text-[10px] text-zinc-400">
                        {clockOf(row.ts)}
                      </span>
                      <SourceBadge source={row.source} />
                      <Badge tone={LEVEL_TONE[row.level] ?? "neutral"}>{row.level}</Badge>
                      <span className="min-w-0 flex-1 truncate text-xs">{row.message}</span>
                      {row.count > 1 ? <Badge tone="red">×{row.count}</Badge> : null}
                      {row.durationMs !== null ? (
                        <span className="shrink-0 text-[10px] text-zinc-400">
                          {row.durationMs}ms
                        </span>
                      ) : null}
                      {row.traceId !== "" ? (
                        <span
                          role="button"
                          tabIndex={0}
                          title="Follow this trace across client and server"
                          onClick={(event) => {
                            event.stopPropagation();
                            apply({ ...filters, source: "all", traceId: row.traceId });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              apply({ ...filters, source: "all", traceId: row.traceId });
                            }
                          }}
                          className="shrink-0 cursor-pointer rounded px-1 font-mono text-[10px] text-sky-600 hover:bg-sky-100 hover:underline dark:text-sky-400 dark:hover:bg-sky-950"
                        >
                          {row.traceId.slice(0, 12)}
                        </span>
                      ) : null}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!hasMore || loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? <Loader2 size={14} className="animate-spin" /> : null}
                Load older
              </Button>
              <span className="text-xs text-zinc-500">
                keyset pagination on (ts, _id) — never skip/offset
              </span>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {selected === null ? null : (
        <div
          role="dialog"
          aria-label="Log detail"
          className="fixed inset-0 z-40 flex justify-end bg-zinc-950/40"
          onClick={() => setSelected(null)}
        >
          <div
            className="h-full w-full max-w-xl overflow-y-auto border-l border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <Badge tone={LEVEL_TONE[selected.level] ?? "neutral"}>{selected.level}</Badge>
              <SourceBadge source={selected.source} />
              <span className="text-xs text-zinc-500">{timeOf(selected.ts)}</span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Copy log JSON"
                  onClick={() => void copyJson(selected)}
                >
                  <Copy size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close detail"
                  onClick={() => setSelected(null)}
                >
                  <X size={14} />
                </Button>
              </div>
            </div>
            <h3 className="mb-3 break-words text-sm font-semibold">{selected.message}</h3>
            {stackLines.length > 0 ? (
              <pre className="mb-3 overflow-x-auto rounded-md bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100">
                {stackLines.map((line, index) => (
                  <span
                    key={`${index}-${line}`}
                    className={index === 0 ? "block text-rose-300" : "block text-zinc-300"}
                  >
                    {line}
                  </span>
                ))}
              </pre>
            ) : null}
            <h4 className="mb-1 text-xs font-semibold">meta</h4>
            <pre className="mb-3 max-h-64 overflow-auto rounded-md bg-zinc-100 p-3 text-[11px] dark:bg-zinc-900">
              {selected.meta === null
                ? "null"
                : JSON.stringify(selected.meta, null, 2)}
            </pre>
            <h4 className="mb-1 text-xs font-semibold">context</h4>
            <table className="w-full text-[11px]">
              <tbody>
                {CONTEXT_FIELDS.map(({ key, label }) => {
                  const value = selected[key];
                  if (value === null || value === undefined || value === "") {
                    return null;
                  }
                  return (
                    <tr key={label} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="w-28 py-1 pr-2 align-top text-zinc-500">{label}</td>
                      <td className="break-all py-1 font-mono">
                        {typeof value === "object" ? JSON.stringify(value) : String(value)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {selected.ts !== "" ? (
              <p className="mt-3 text-[10px] text-zinc-400">
                client ts {timeOf(selected.ts)} · received {timeOf(selected.receivedAt)}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
