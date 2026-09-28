import type mongoose from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import { EventModel, type EventDoc, type EventType } from "@/lib/db/events";
import { DailyStatModel } from "@/lib/db/ops";
import { toCsv } from "@/lib/csv";
import { kindCanWriteEvents, type VerifiedKey } from "@/lib/apiKeys";
import { ProjectModel } from "@/lib/db/projects";
import { getProjectById } from "@/lib/projects";
import { appTimezone, visitorPepper } from "@/lib/env";
import { enforceRateLimit } from "@/lib/ratelimit";
import { getSettings } from "@/lib/settings";
import { parseUserAgent } from "@/lib/ua";
import { ensureCurrentDayRollup, rangeDates, readRollups } from "@/lib/rollup";
import {
  IngestError,
  MAX_EXPORT_ROWS,
  cleanText,
  metaSize,
  objectIdOrNull,
  parseIngestTs,
} from "@/lib/ingest";
import {
  MAX_META_BYTES,
  analyticsQuerySchema,
  eventIngestSchema,
} from "@/lib/validation";
import { addDays, isBot, utcDateKey, visitorId as deriveVisitorId } from "@/lib/visitor";

export const ANALYTICS_LIMITS = {
  requestsPerMinute: 30,
  eventsPerMinute: 600,
  eventsPerHour: 3000,
} as const;

export const MAX_PATH_CHARS = 512;
export const MAX_NAME_CHARS = 120;
export const MAX_UTM_CHARS = 120;
export const MAX_UA_CHARS = 500;
export const ACTIVE_WINDOW_MS = 5 * 60_000;
export const UTM_PREFIX = "utm:";
export const MAX_TRACKED_PROJECTS = 50;

export const UTM_FIELDS = [
  "source",
  "medium",
  "campaign",
  "term",
  "content",
] as const;

export const EVENT_SERVER_DERIVED_FIELDS = [
  "visitorId",
  "ip",
  "country",
  "device",
  "browser",
  "os",
  "keyPrefix",
  "projectId",
  "receivedAt",
  "rejected",
  "source",
  "_id",
] as const;

export type AnalyticsIngestContext = {
  key: VerifiedKey;
  headers: Headers;
  ip: string;
  country: string;
};

export type AnalyticsIngestSummary = {
  accepted: number;
  rejected: number;
  stored: number;
  stale: number;
  bots: number;
};

export type OriginVerdict = "ok" | "disabled" | "cross_site";

export type PreparedEvent = { doc: EventDoc };

export type EventRejection = "forbidden" | "stale" | "props_too_large" | "bot";

export type AnalyticsRange = "today" | "7d" | "30d" | "custom";

export type AnalyticsQuery = {
  range?: string;
  from?: Date | string;
  to?: Date | string;
};

export type ResolvedRange = {
  range: AnalyticsRange;
  start: Date;
  end: Date;
  days: number;
};

export type RankedCount = { name: string; count: number };

export type SeriesPoint = {
  date: string;
  pageviews: number;
  visitors: number;
  clicks: number;
  customEvents: number;
};

export type UtmRow = {
  source: string;
  medium: string;
  campaign: string;
  count: number;
};

export type AnalyticsTotals = {
  pageviews: number;
  visitors: number;
  clicks: number;
  customEvents: number;
  activeNow: number;
};

export type AnalyticsSummary = {
  projectId: string;
  range: AnalyticsRange;
  timezone: string;
  from: string;
  to: string;
  days: number;
  activeWindowMinutes: number;
  totals: AnalyticsTotals;
  series: SeriesPoint[];
  topPages: RankedCount[];
  entryPages: RankedCount[];
  referrers: RankedCount[];
  sources: RankedCount[];
  utm: UtmRow[];
  devices: RankedCount[];
  browsers: RankedCount[];
  os: RankedCount[];
  countries: RankedCount[];
  clicks: RankedCount[];
  customEvents: RankedCount[];
  generatedAt: string;
};

export type ProjectAnalyticsTotals = {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  color: string;
  analyticsEnabled: boolean;
  pageviews: number;
  visitors: number;
  clicks: number;
  customEvents: number;
};

export type ProjectTotals = {
  range: AnalyticsRange;
  timezone: string;
  from: string;
  to: string;
  totals: AnalyticsTotals;
  series: SeriesPoint[];
  projects: ProjectAnalyticsTotals[];
  generatedAt: string;
};

export type SerializedEvent = {
  ts: string;
  receivedAt: string;
  type: string;
  name: string;
  path: string;
  visitorId: string;
  sessionId: string;
  referrer: string;
  utm: Record<string, string>;
  device: string;
  browser: string;
  os: string;
  country: string;
  ip: string;
  keyPrefix: string;
  props: unknown;
};

export const EVENT_EXPORT_COLUMNS = [
  "ts",
  "receivedAt",
  "type",
  "name",
  "path",
  "visitorId",
  "sessionId",
  "referrer",
  "utm",
  "device",
  "browser",
  "os",
  "country",
  "ip",
  "keyPrefix",
  "props",
] as const;

const TOP_LIMIT = 25;
const UTM_LIMIT = 25;
const COUNTRY_PATTERN = /^[A-Za-z]{2}$/;
const EMPTY_SERIES: SeriesPoint = {
  date: "",
  pageviews: 0,
  visitors: 0,
  clicks: 0,
  customEvents: 0,
};

export function rollupKeySafe(value: string | undefined, max: number): string {
  return cleanText(value, max).trim().replace(/^\$+/, "");
}

export function cleanCountry(raw: string): string {
  const candidate = cleanText(raw, 8).trim().toUpperCase();
  return COUNTRY_PATTERN.test(candidate) ? candidate : "";
}

export function hasForbiddenEventFields(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) {
    return true;
  }
  const record = entry as Record<string, unknown>;
  return EVENT_SERVER_DERIVED_FIELDS.some((field) => Object.hasOwn(record, field));
}

export function hostsFromLinks(
  links: readonly { type: string; url: string }[] | undefined,
): string[] {
  if (links === undefined || links === null) {
    return [];
  }
  const hosts: string[] = [];
  for (const link of links) {
    if (link.type === "live" || link.type === "docs" || link.type === "other") {
      try {
        const host = new URL(link.url).host.toLowerCase();
        if (host !== "" && !hosts.includes(host)) {
          hosts.push(host);
        }
      } catch {
        void 0;
      }
    }
  }
  return hosts;
}

function hostOf(raw: string): string | null {
  if (raw === "" || raw === "null") {
    return null;
  }
  try {
    return new URL(raw).host.toLowerCase();
  } catch {
    return null;
  }
}

function hostMatches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

export function originCheck(headers: Headers, allowedHosts: readonly string[]): OriginVerdict {
  if (allowedHosts.length === 0) {
    return "disabled";
  }
  const origin = hostOf(headers.get("origin")?.trim() ?? "");
  if (origin !== null) {
    return allowedHosts.some((allowed) => hostMatches(origin, allowed)) ? "ok" : "cross_site";
  }
  return "ok";
}

export function cleanUtm(raw: unknown): Record<string, string> {
  const source =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const utm: Record<string, string> = {};
  for (const field of UTM_FIELDS) {
    const value = source[field];
    const cleaned = typeof value === "string" ? rollupKeySafe(value, MAX_UTM_CHARS) : "";
    if (cleaned !== "") {
      utm[field] = cleaned;
    }
  }
  return utm;
}

function hasAnyUtm(utm: Record<string, string>): boolean {
  return UTM_FIELDS.some((field) => utm[field] !== undefined);
}

export function prepareEvent(
  entry: Record<string, unknown>,
  context: {
    projectId: mongoose.Types.ObjectId;
    keyPrefix: string;
    ip: string;
    country: string;
    now: Date;
    headerUserAgent: string | undefined;
  },
): PreparedEvent | { error: EventRejection } {
  if (hasForbiddenEventFields(entry)) {
    return { error: "forbidden" };
  }
  const verdict = parseIngestTs(entry.ts as string | number | undefined, context.now);
  if (!verdict.ok) {
    return { error: "stale" };
  }
  if (metaSize(entry.props) > MAX_META_BYTES) {
    return { error: "props_too_large" };
  }
  const userAgent = cleanText(
    context.headerUserAgent ?? (typeof entry.ua === "string" ? entry.ua : undefined),
    MAX_UA_CHARS,
  );
  if (isBot(userAgent)) {
    return { error: "bot" };
  }
  const parsed = parseUserAgent(userAgent);
  const utm = cleanUtm(entry.utm);
  const path = rollupKeySafe(entry.path as string | undefined, MAX_PATH_CHARS) || "/";
  const doc = {
    projectId: context.projectId,
    keyPrefix: context.keyPrefix,
    type: entry.type as EventType,
    name: rollupKeySafe(entry.name as string | undefined, MAX_NAME_CHARS),
    path,
    props: entry.props,
    visitorId: deriveVisitorId(context.ip, userAgent, visitorPepper(), context.now),
    sessionId: cleanText(entry.sessionId as string | undefined, 80),
    referrer: rollupKeySafe(entry.referrer as string | undefined, MAX_PATH_CHARS),
    utm: hasAnyUtm(utm) ? utm : undefined,
    device: rollupKeySafe(parsed.device, 40) || "desktop",
    browser: rollupKeySafe(parsed.browser, 80),
    os: rollupKeySafe(parsed.os, 80),
    country: cleanCountry(context.country),
    ip: context.ip,
    rejected: false,
    ts: verdict.ts,
    receivedAt: context.now,
  } as unknown as EventDoc;
  return { doc };
}

export async function ingestEvents(
  payload: unknown,
  context: AnalyticsIngestContext,
): Promise<AnalyticsIngestSummary> {
  const settings = await getSettings();
  if (!settings.analyticsEnabled) {
    throw new IngestError("analytics_disabled", 403, "analytics ingest is disabled");
  }
  if (!context.key.analyticsEnabled) {
    throw new IngestError("analytics_disabled", 403, "analytics ingest is disabled for project");
  }
  if (!kindCanWriteEvents(context.key.kind)) {
    throw new IngestError("unauthorized", 401, "invalid key");
  }

  const projectId = objectIdOrNull(context.key.projectId);
  if (projectId === null) {
    throw new IngestError("unauthorized", 401, "invalid key");
  }
  const project = await getProjectById(context.key.projectId);
  if (project === null) {
    throw new IngestError("unauthorized", 401, "invalid key");
  }
  const originVerdict = originCheck(context.headers, hostsFromLinks(project.links ?? []));
  if (originVerdict === "cross_site") {
    throw new IngestError("cross_site", 403, "origin does not match the project host");
  }

  const perRequest = await enforceRateLimit(
    `ingest:events:req:${context.key.keyId}`,
    ANALYTICS_LIMITS.requestsPerMinute,
    60,
    { durable: true },
  );
  if (!perRequest.allowed) {
    throw new IngestError(
      "rate_limited",
      429,
      "rate limit exceeded",
      perRequest.retryAfterSeconds,
    );
  }

  const parsed = eventIngestSchema.safeParse(payload);
  if (!parsed.success) {
    throw new IngestError(
      "invalid_payload",
      400,
      `invalid payload (${parsed.error.issues.length} issues)`,
    );
  }
  if (parsed.data.events.length > settings.maxEventBatch) {
    throw new IngestError("batch_too_large", 400, "batch exceeds the configured cap");
  }

  const perMinute = await enforceRateLimit(
    `ingest:events:min:${context.key.keyId}`,
    ANALYTICS_LIMITS.eventsPerMinute,
    60,
    { durable: true },
  );
  if (!perMinute.allowed) {
    throw new IngestError(
      "rate_limited",
      429,
      "event quota exceeded",
      perMinute.retryAfterSeconds,
    );
  }
  const perHour = await enforceRateLimit(
    `ingest:events:hour:${context.key.keyId}`,
    ANALYTICS_LIMITS.eventsPerHour,
    3600,
    { durable: true },
  );
  if (!perHour.allowed) {
    throw new IngestError(
      "rate_limited",
      429,
      "hourly event quota exceeded",
      perHour.retryAfterSeconds,
    );
  }

  await connectToDatabase();
  const now = new Date();
  const headerUserAgent = context.headers.get("user-agent") ?? undefined;
  const ip = cleanText(context.ip, 64);
  const country = cleanCountry(context.country);
  const prepared: EventDoc[] = [];
  let rejected = 0;
  let stale = 0;
  let bots = 0;

  for (const raw of parsed.data.events) {
    const result = prepareEvent(raw as Record<string, unknown>, {
      projectId,
      keyPrefix: context.key.prefix,
      ip,
      country,
      now,
      headerUserAgent,
    });
    if ("error" in result) {
      rejected += 1;
      if (result.error === "stale") {
        stale += 1;
      }
      if (result.error === "bot") {
        bots += 1;
      }
      continue;
    }
    prepared.push(result.doc);
  }

  let stored = 0;
  if (prepared.length > 0) {
    await EventModel.insertMany(prepared);
    stored = prepared.length;
  }

  return { accepted: stored, rejected, stored, stale, bots };
}

export function resolveRange(query: AnalyticsQuery = {}): ResolvedRange {
  const parsed = analyticsQuerySchema.safeParse({
    range: query.range ?? undefined,
    from: query.from ?? undefined,
    to: query.to ?? undefined,
  });
  if (!parsed.success) {
    throw new IngestError("invalid_range", 400, "invalid analytics range");
  }
  const data = parsed.data;
  const range = data.range;
  const { start, end } = rangeDates(range, data.from, data.to);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  return { range, start, end, days };
}

export function mergeCountMaps(
  maps: readonly Record<string, number>[],
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const map of maps) {
    for (const [key, value] of Object.entries(map)) {
      const amount = typeof value === "number" && Number.isFinite(value) ? value : 0;
      merged[key] = (merged[key] ?? 0) + amount;
    }
  }
  return merged;
}

export function rankCounts(
  map: Record<string, number>,
  limit = TOP_LIMIT,
): RankedCount[] {
  return Object.entries(map)
    .filter(([name]) => name !== "")
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) =>
      b.count === a.count ? a.name.localeCompare(b.name) : b.count - a.count,
    )
    .slice(0, limit);
}

export function pickByPrefix(
  map: Record<string, number>,
  prefix: string,
): Record<string, number> {
  const picked: Record<string, number> = {};
  for (const [key, value] of Object.entries(map)) {
    if (key.startsWith(prefix)) {
      const name = key.slice(prefix.length);
      if (name !== "") {
        picked[name] = value;
      }
    }
  }
  return picked;
}

export function alignSeries(
  rollups: readonly Pick<
    SeriesPoint,
    "date" | "pageviews" | "visitors" | "clicks" | "customEvents"
  >[],
  start: Date,
  end: Date,
): SeriesPoint[] {
  const byDate = new Map(rollups.map((row) => [row.date, row]));
  const series: SeriesPoint[] = [];
  for (let day = dailyStart(start); day.getTime() < end.getTime(); day = addDays(day, 1)) {
    const date = utcDateKey(day);
    const row = byDate.get(date);
    series.push({
      date,
      pageviews: row?.pageviews ?? 0,
      visitors: row?.visitors ?? 0,
      clicks: row?.clicks ?? 0,
      customEvents: row?.customEvents ?? 0,
    });
  }
  return series;
}

function dailyStart(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function sumSeries(series: readonly SeriesPoint[]): AnalyticsTotals {
  return series.reduce<AnalyticsTotals>(
    (totals, point) => ({
      pageviews: totals.pageviews + point.pageviews,
      visitors: totals.visitors + point.visitors,
      clicks: totals.clicks + point.clicks,
      customEvents: totals.customEvents + point.customEvents,
      activeNow: totals.activeNow,
    }),
    { pageviews: 0, visitors: 0, clicks: 0, customEvents: 0, activeNow: 0 },
  );
}

export function combineSeries(
  series: readonly SeriesPoint[][],
): SeriesPoint[] {
  const combined = new Map<string, SeriesPoint>();
  for (const points of series) {
    for (const point of points) {
      const current = combined.get(point.date) ?? { ...EMPTY_SERIES, date: point.date };
      current.pageviews += point.pageviews;
      current.visitors += point.visitors;
      current.clicks += point.clicks;
      current.customEvents += point.customEvents;
      combined.set(point.date, current);
    }
  }
  return [...combined.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function distinctVisitors(
  projectId: mongoose.Types.ObjectId,
  window: { $gte: Date; $lt?: Date },
): Promise<number> {
  const visitors = await EventModel.distinct("visitorId", {
    projectId,
    rejected: { $ne: true },
    ts: window,
  });
  return visitors.filter(
    (value): value is string => typeof value === "string" && value !== "",
  ).length;
}

async function entryPageRanking(
  projectId: mongoose.Types.ObjectId,
  start: Date,
  end: Date,
  limit: number,
): Promise<RankedCount[]> {
  const rows = await EventModel.aggregate<{ _id: string; count: number }>([
    {
      $match: {
        projectId,
        rejected: { $ne: true },
        type: "pageview",
        ts: { $gte: start, $lt: end },
      },
    },
    { $project: { _id: 1, visitorId: 1, path: 1, ts: 1 } },
    { $sort: { visitorId: 1, ts: 1, _id: 1 } },
    { $group: { _id: "$visitorId", first: { $first: "$path" } } },
    { $match: { first: { $exists: true, $nin: ["", null] } } },
    { $group: { _id: "$first", count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: limit },
  ]);
  return rows.map((row) => ({ name: String(row._id), count: row.count }));
}

async function utmBreakdown(
  projectId: mongoose.Types.ObjectId,
  start: Date,
  end: Date,
  limit: number,
): Promise<UtmRow[]> {
  const rows = await EventModel.aggregate<{
    _id: { source: string; medium: string; campaign: string };
    count: number;
  }>([
    {
      $match: {
        projectId,
        rejected: { $ne: true },
        type: "pageview",
        ts: { $gte: start, $lt: end },
      },
    },
    { $match: { "utm.source": { $exists: true, $nin: ["", null] } } },
    {
      $group: {
        _id: {
          source: { $ifNull: ["$utm.source", ""] },
          medium: { $ifNull: ["$utm.medium", ""] },
          campaign: { $ifNull: ["$utm.campaign", ""] },
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1, "_id.source": 1 } },
    { $limit: limit },
  ]);
  return rows.map((row) => ({
    source: String(row._id.source ?? ""),
    medium: String(row._id.medium ?? ""),
    campaign: String(row._id.campaign ?? ""),
    count: row.count,
  }));
}

export async function analyticsSummary(
  projectId: string,
  query: AnalyticsQuery = {},
): Promise<AnalyticsSummary> {
  const id = objectIdOrNull(projectId);
  if (id === null) {
    throw new IngestError("invalid_project", 400, "invalid project id");
  }
  const { range, start, end, days } = resolveRange(query);
  await ensureCurrentDayRollup(projectId);
  const rollups = await readRollups(projectId, start, end);
  const series = alignSeries(rollups, start, end);
  const totals = sumSeries(series);
  totals.visitors = await distinctVisitors(id, { $gte: start, $lt: end });
  totals.activeNow = await distinctVisitors(id, {
    $gte: new Date(Date.now() - ACTIVE_WINDOW_MS),
  });

  const byReferrer = mergeCountMaps(rollups.map((row) => row.byReferrer));
  const [entryPages, utm] = await Promise.all([
    entryPageRanking(id, start, end, TOP_LIMIT),
    utmBreakdown(id, start, end, UTM_LIMIT),
  ]);

  return {
    projectId,
    range,
    timezone: appTimezone(),
    from: start.toISOString(),
    to: end.toISOString(),
    days,
    activeWindowMinutes: ACTIVE_WINDOW_MS / 60_000,
    totals,
    series,
    topPages: rankCounts(mergeCountMaps(rollups.map((row) => row.byPath))),
    entryPages,
    referrers: rankCounts(stripPrefixKeys(byReferrer)),
    sources: rankCounts(pickByPrefix(byReferrer, UTM_PREFIX)),
    utm,
    devices: rankCounts(mergeCountMaps(rollups.map((row) => row.byDevice))),
    browsers: rankCounts(mergeCountMaps(rollups.map((row) => row.byBrowser))),
    os: rankCounts(mergeCountMaps(rollups.map((row) => row.byOs))),
    countries: rankCounts(mergeCountMaps(rollups.map((row) => row.byCountry))),
    clicks: rankCounts(mergeCountMaps(rollups.map((row) => row.clicksByTarget))),
    customEvents: rankCounts(mergeCountMaps(rollups.map((row) => row.byEvent))),
    generatedAt: new Date().toISOString(),
  };
}

function stripPrefixKeys(map: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(map)) {
    if (!key.startsWith(UTM_PREFIX)) {
      result[key] = value;
    }
  }
  return result;
}

export async function projectTotals(query: AnalyticsQuery = {}): Promise<ProjectTotals> {
  const { range, start, end } = resolveRange(query);
  await connectToDatabase();
  const projects = await ProjectModel.find(
    {},
    { slug: 1, name: 1, emoji: 1, color: 1, analyticsEnabled: 1 },
  )
    .sort({ name: 1 })
    .limit(MAX_TRACKED_PROJECTS)
    .lean();
  for (const project of projects) {
    await ensureCurrentDayRollup(String(project._id));
  }
  const fromKey = utcDateKey(start);
  const toKey = utcDateKey(end);
  const rows = await DailyStatModel.aggregate<{
    _id: string;
    pageviews: number;
    visitors: number;
    clicks: number;
    customEvents: number;
    byDate: { date: string; pageviews: number; visitors: number; clicks: number; customEvents: number }[];
  }>([
    { $match: { date: { $gte: fromKey, $lt: toKey } } },
    {
      $group: {
        _id: { project: "$projectId", date: "$date" },
        pageviews: { $sum: "$pageviews" },
        visitors: { $sum: "$visitors" },
        clicks: { $sum: "$clicks" },
        customEvents: { $sum: "$customEvents" },
      },
    },
    {
      $group: {
        _id: "$_id.project",
        pageviews: { $sum: "$pageviews" },
        visitors: { $sum: "$visitors" },
        clicks: { $sum: "$clicks" },
        customEvents: { $sum: "$customEvents" },
        byDate: {
          $push: {
            date: "$_id.date",
            pageviews: "$pageviews",
            visitors: "$visitors",
            clicks: "$clicks",
            customEvents: "$customEvents",
          },
        },
      },
    },
  ]);

  const rollupByProject = new Map(
    rows.map((row) => [
      String(row._id),
      alignSeries(
        row.byDate
          .map(
            (entry): SeriesPoint => ({
              date: entry.date,
              pageviews: entry.pageviews,
              visitors: entry.visitors,
              clicks: entry.clicks,
              customEvents: entry.customEvents,
            }),
          )
          .sort((a, b) => a.date.localeCompare(b.date)),
        start,
        end,
      ),
    ]),
  );
  const totalsByProject = new Map(
    rows.map((row) => [
      String(row._id),
      {
        pageviews: row.pageviews,
        visitors: row.visitors,
        clicks: row.clicks,
        customEvents: row.customEvents,
      },
    ]),
  );

  const series: SeriesPoint[] = [];
  const projectRows: ProjectAnalyticsTotals[] = [];
  for (const project of projects) {
    const id = String(project._id);
    const points = rollupByProject.get(id) ?? [];
    series.push(...points);
    const totals = totalsByProject.get(id);
    projectRows.push({
      id,
      slug: project.slug,
      name: project.name,
      emoji: project.emoji ?? "📁",
      color: project.color ?? "#6366f1",
      analyticsEnabled: project.analyticsEnabled !== false,
      pageviews: totals?.pageviews ?? 0,
      visitors: totals?.visitors ?? 0,
      clicks: totals?.clicks ?? 0,
      customEvents: totals?.customEvents ?? 0,
    });
  }

  const combined = alignSeries(series, start, end);
  const totals = sumSeries(combined);
  return {
    range,
    timezone: appTimezone(),
    from: start.toISOString(),
    to: end.toISOString(),
    totals: { ...totals, activeNow: 0 },
    series: combined,
    projects: projectRows.sort((a, b) => b.pageviews - a.pageviews),
    generatedAt: new Date().toISOString(),
  };
}

function isoOf(value: unknown): string {
  return value instanceof Date ? value.toISOString() : "";
}

export function serializeEvent(row: EventDoc & { _id: mongoose.Types.ObjectId }): SerializedEvent {
  const value = row as unknown as Record<string, unknown>;
  const str = (key: string): string => {
    const raw = value[key];
    return typeof raw === "string" ? raw : "";
  };
  return {
    ts: isoOf(value.ts),
    receivedAt: isoOf(value.receivedAt),
    type: str("type"),
    name: str("name"),
    path: str("path"),
    visitorId: str("visitorId"),
    sessionId: str("sessionId"),
    referrer: str("referrer"),
    utm: cleanUtm(value.utm),
    device: str("device"),
    browser: str("browser"),
    os: str("os"),
    country: str("country"),
    ip: str("ip"),
    keyPrefix: str("keyPrefix"),
    props: value.props ?? null,
  };
}

export async function exportEvents(
  projectId: string,
  query: AnalyticsQuery,
  format: "csv" | "json",
): Promise<{ body: string; count: number; contentType: string }> {
  const id = objectIdOrNull(projectId);
  if (id === null) {
    throw new IngestError("invalid_project", 400, "invalid project id");
  }
  const { start, end } = resolveRange(query);
  await connectToDatabase();
  const rows = await EventModel.find({
    projectId: id,
    rejected: { $ne: true },
    ts: { $gte: start, $lt: end },
  })
    .sort({ ts: -1 })
    .limit(MAX_EXPORT_ROWS)
    .lean();

  const events = (rows as (EventDoc & { _id: mongoose.Types.ObjectId })[]).map(
    serializeEvent,
  );
  if (format === "json") {
    return {
      body: JSON.stringify({ from: start.toISOString(), to: end.toISOString(), events }, null, 2),
      count: events.length,
      contentType: "application/json; charset=utf-8",
    };
  }
  return {
    body: toCsv(
      EVENT_EXPORT_COLUMNS,
      events.map((event) => ({
        ...event,
        utm: JSON.stringify(event.utm),
        props: event.props === null ? "" : JSON.stringify(event.props),
      })),
    ),
    count: events.length,
    contentType: "text/csv; charset=utf-8",
  };
}
