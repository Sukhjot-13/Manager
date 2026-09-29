import { connectToDatabase } from "@/lib/db/connect";
import { DailyStatModel } from "@/lib/db/ops";
import { EventModel } from "@/lib/db/events";
import { addDays, dailyWindowStart, utcDateKey } from "@/lib/visitor";

type RollupInput = {
  type: string;
  path: string;
  name: string;
  visitorId: string;
  referrer: string;
  country: string;
  device: string;
  browser: string;
  os: string;
  utmSource: string;
};

type DimensionCap = { maxKeys: number; otherKey: string };

const DIMENSION_CAP: DimensionCap = { maxKeys: 200, otherKey: "__other__" };

function increment(
  map: Record<string, number> | undefined,
  key: string,
  by = 1,
): Record<string, number> {
  const source = { ...(map ?? {}) };
  const safeKey = sanitizeDimensionKey(key);
  if (safeKey === "") {
    return source;
  }
  if (!(safeKey in source) && Object.keys(source).length >= DIMENSION_CAP.maxKeys) {
    const current = source[DIMENSION_CAP.otherKey] ?? 0;
    source[DIMENSION_CAP.otherKey] = current + by;
    return source;
  }
  const current = typeof source[safeKey] === "number" ? source[safeKey] : 0;
  source[safeKey] = current + by;
  return source;
}

function sanitizeDimensionKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed === "") {
    return "/";
  }
  return trimmed.slice(0, 300);
}

export async function rollupDay(
  projectId: string,
  day: Date,
): Promise<void> {
  await connectToDatabase();
  const start = dailyWindowStart(day);
  const end = addDays(start, 1);
  const date = utcDateKey(start);
  const events = await EventModel.find({
    projectId,
    rejected: { $ne: true },
    ts: { $gte: start, $lt: end },
  })
    .select({
      type: 1,
      path: 1,
      name: 1,
      visitorId: 1,
      referrer: 1,
      country: 1,
      device: 1,
      browser: 1,
      os: 1,
      utm: 1,
    })
    .lean();

  const rollup = {
    pageviews: 0,
    visitors: 0,
    clicks: 0,
    customEvents: 0,
    byPath: {} as Record<string, number>,
    byCountry: {} as Record<string, number>,
    byReferrer: {} as Record<string, number>,
    byDevice: {} as Record<string, number>,
    byBrowser: {} as Record<string, number>,
    byOs: {} as Record<string, number>,
    clicksByTarget: {} as Record<string, number>,
    byEvent: {} as Record<string, number>,
    visitorIds: [] as string[],
  };
  const visitors = new Set<string>();

  for (const event of events) {
    const input: RollupInput = {
      type: event.type,
      path: event.path ?? "",
      name: event.name ?? "",
      visitorId: event.visitorId ?? "",
      referrer: event.referrer ?? "",
      country: event.country ?? "",
      device: event.device ?? "",
      browser: event.browser ?? "",
      os: event.os ?? "",
      utmSource: (event.utm as { source?: string } | undefined)?.source ?? "",
    };
    if (input.visitorId !== "") {
      visitors.add(input.visitorId);
    }
    if (input.type === "pageview") {
      rollup.pageviews += 1;
      rollup.byPath = increment(rollup.byPath, input.path || "/");
      if (input.referrer !== "") {
        rollup.byReferrer = increment(rollup.byReferrer, input.referrer);
      }
      if (input.utmSource !== "") {
        rollup.byReferrer = increment(rollup.byReferrer, `utm:${input.utmSource}`);
      }
    } else if (input.type === "click") {
      rollup.clicks += 1;
      rollup.clicksByTarget = increment(rollup.clicksByTarget, input.name);
    } else {
      rollup.customEvents += 1;
      rollup.byEvent = increment(rollup.byEvent, input.name);
    }
    if (input.country !== "") {
      rollup.byCountry = increment(rollup.byCountry, input.country);
    }
    if (input.device !== "") {
      rollup.byDevice = increment(rollup.byDevice, input.device);
    }
    if (input.browser !== "") {
      rollup.byBrowser = increment(rollup.byBrowser, input.browser);
    }
    if (input.os !== "") {
      rollup.byOs = increment(rollup.byOs, input.os);
    }
  }
  rollup.visitors = visitors.size;
  rollup.visitorIds = [...visitors];

  await DailyStatModel.updateOne(
    { projectId, date },
    { $set: { ...rollup, projectId, date } },
    { upsert: true },
  ).exec();
}

/**
 * The UTC instant of local midnight in `timeZone` for the local day containing `now`.
 *
 * Rollup buckets stay keyed by UTC day (plan §F5: store UTC everywhere), but the
 * dashboard's "today" must mean the user's today. Without this, an owner in UTC-4 sees
 * an empty dashboard every evening between 00:00 and 20:00 local time.
 */
type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function zonedParts(now: Date, timeZone: string): ZonedParts | null {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return null;
  }
  const parts = new Map(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const read = (key: "year" | "month" | "day" | "hour" | "minute" | "second"): number =>
    Number(parts.get(key));
  const year = read("year");
  const month = read("month");
  const day = read("day");
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return {
    year,
    month,
    day,
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

/** Milliseconds `timeZone` is ahead of UTC at `instant` (east of Greenwich is positive). */
function zoneOffsetMs(instant: Date, timeZone: string): number | null {
  const parts = zonedParts(instant, timeZone);
  if (parts === null) {
    return null;
  }
  const wallAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant of local midnight for the day containing `now` in `timeZone`.
 *
 * Rollup buckets stay keyed by the UTC day (plan §F5: store UTC everywhere), but the
 * dashboard's "today" has to mean the user's today. Without this, an owner west of UTC
 * sees an empty dashboard every evening, and one east of UTC sees tomorrow's data early.
 */
export function localDayStartUtc(now: Date, timeZone: string): Date {
  if (timeZone === "UTC") {
    return dailyWindowStart(now);
  }
  const local = zonedParts(now, timeZone);
  if (local === null) {
    return dailyWindowStart(now);
  }
  const wallMidnight = Date.UTC(local.year, local.month - 1, local.day, 0, 0, 0);
  const offset = zoneOffsetMs(new Date(wallMidnight), timeZone);
  if (offset === null) {
    return dailyWindowStart(now);
  }
  return new Date(wallMidnight - offset);
}

export function rangeDates(
  range: "today" | "7d" | "30d" | "custom",
  from?: Date,
  to?: Date,
  timeZone = "UTC",
): { start: Date; end: Date } {
  const now = new Date();
  if (range === "today") {
    const start = localDayStartUtc(now, timeZone);
    return { start, end: addDays(start, 1) };
  }
  if (range === "custom" && from !== undefined && to !== undefined) {
    const start = localDayStartUtc(from, timeZone);
    return { start, end: localDayStartUtc(addDays(to, 1), timeZone) };
  }
  const days = range === "30d" ? 30 : 7;
  const anchor = localDayStartUtc(now, timeZone);
  return { start: addDays(anchor, -(days - 1)), end: addDays(anchor, 1) };
}

export type DailyRollup = {
  date: string;
  pageviews: number;
  visitors: number;
  clicks: number;
  customEvents: number;
  byPath: Record<string, number>;
  byCountry: Record<string, number>;
  byReferrer: Record<string, number>;
  byDevice: Record<string, number>;
  byBrowser: Record<string, number>;
  byOs: Record<string, number>;
  clicksByTarget: Record<string, number>;
  byEvent: Record<string, number>;
};

function toRecord(value: unknown): Record<string, number> {
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entry]) => [String(key), Number(entry)]),
    );
  }
  if (value === null || value === undefined || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      Number(entry),
    ]),
  );
}

export async function readRollups(
  projectId: string,
  start: Date,
  end: Date,
): Promise<DailyRollup[]> {
  await connectToDatabase();
  // Inclusive of the UTC bucket that `end` falls inside, because a display-timezone day
  // can straddle two or three UTC buckets.
  const lastKey = utcDateKey(new Date(end.getTime() - 1));
  const rows = await DailyStatModel.find({
    projectId,
    date: { $gte: utcDateKey(start), $lte: lastKey },
  })
    .sort({ date: 1 })
    .lean();
  return rows.map((row) => ({
    date: row.date,
    pageviews: row.pageviews,
    visitors: row.visitors,
    clicks: row.clicks,
    customEvents: row.customEvents,
    byPath: toRecord(row.byPath),
    byCountry: toRecord(row.byCountry),
    byReferrer: toRecord(row.byReferrer),
    byDevice: toRecord(row.byDevice),
    byBrowser: toRecord(row.byBrowser),
    byOs: toRecord(row.byOs),
    clicksByTarget: toRecord(row.clicksByTarget),
    byEvent: toRecord(row.byEvent),
  }));
}

export async function ensureCurrentDayRollup(projectId: string): Promise<void> {
  await rollupDay(projectId, new Date());
}
