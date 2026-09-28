import mongoose, { Types } from "mongoose";
import { connectToDatabase } from "@/lib/db/connect";
import {
  LogModel,
  type LogDoc,
  type LogLevel,
  type LogSource,
} from "@/lib/db/logs";
import { kindCanWriteLogs, sourceForKind, type VerifiedKey } from "@/lib/apiKeys";
import { capString, fingerprint, stripControlChars } from "@/lib/fingerprint";
import { enforceRateLimit } from "@/lib/ratelimit";
import { getSettings } from "@/lib/settings";
import { parseUserAgent } from "@/lib/ua";
import {
  logIngestSchema,
  MAX_META_BYTES,
  MAX_TS_AGE_MS,
  MAX_TS_FUTURE_MS,
} from "@/lib/validation";

export const MAX_MESSAGE_CHARS = 1024;
export const MAX_STACK_CHARS = 8000;
export const MAX_UA_CHARS = 500;
export const MAX_STRING_CHARS = 500;

export const INGEST_LIMITS = {
  requestsPerMinute: 60,
  entriesPerHour: 5000,
  groupWindowMs: 60_000,
} as const;

export const SERVER_DERIVED_FIELDS = [
  "source",
  "ip",
  "country",
  "receivedAt",
  "keyPrefix",
  "projectId",
  "fingerprint",
  "count",
  "_id",
] as const;

export const NODE_RUNTIME_FIELDS = [
  "hostname",
  "pid",
  "runtimeVersion",
  "rssMb",
  "uptimeSec",
] as const;

const ERROR_LEVELS: readonly string[] = ["error", "fatal"];

export class IngestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds: number;

  constructor(code: string, status: number, message: string, retryAfterSeconds = 0) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type IngestContext = {
  key: VerifiedKey;
  headers: Headers;
  ip: string;
  country: string;
};

export type IngestSummary = {
  accepted: number;
  rejected: number;
  duplicates: number;
  stored: number;
  stale: number;
};

export type TimestampVerdict =
  | { ok: true; ts: Date }
  | { ok: false; reason: "invalid" | "stale" };

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function objectIdOrNull(value: string): mongoose.Types.ObjectId | null {
  return /^[a-f0-9]{24}$/i.test(value) ? new mongoose.Types.ObjectId(value) : null;
}

export function parseIngestTs(
  value: string | number | undefined,
  now: Date = new Date(),
): TimestampVerdict {
  if (value === undefined) {
    return { ok: true, ts: new Date(now) };
  }
  let ms: number;
  if (typeof value === "number") {
    ms = value;
  } else {
    const trimmed = value.trim();
    if (trimmed === "") {
      return { ok: false, reason: "invalid" };
    }
    ms = /^-?\d+$/.test(trimmed) ? Number(trimmed) : Date.parse(trimmed);
  }
  if (!Number.isFinite(ms) || Math.abs(ms) > 1e14) {
    return { ok: false, reason: "invalid" };
  }
  if (now.getTime() - ms > MAX_TS_AGE_MS) {
    return { ok: false, reason: "stale" };
  }
  if (ms - now.getTime() > MAX_TS_FUTURE_MS) {
    return { ok: false, reason: "stale" };
  }
  return { ok: true, ts: new Date(ms) };
}

export function cleanText(value: string | undefined, max: number): string {
  if (value === undefined) {
    return "";
  }
  return capString(stripControlChars(value), max);
}

export function metaSize(meta: unknown): number {
  if (meta === undefined) {
    return 0;
  }
  try {
    return new TextEncoder().encode(JSON.stringify(meta) ?? "").length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function hasForbiddenFields(
  entry: unknown,
  source: LogSource,
): boolean {
  if (typeof entry !== "object" || entry === null) {
    return true;
  }
  const record = entry as Record<string, unknown>;
  for (const field of SERVER_DERIVED_FIELDS) {
    if (Object.hasOwn(record, field)) {
      return true;
    }
  }
  if (source === "client") {
    for (const field of NODE_RUNTIME_FIELDS) {
      if (Object.hasOwn(record, field)) {
        return true;
      }
    }
  }
  return false;
}

export type PreparedEntry = {
  doc: LogDoc;
  fingerprint: string;
};

export function prepareEntry(
  entry: Record<string, unknown>,
  context: {
    projectId: mongoose.Types.ObjectId;
    source: LogSource;
    keyPrefix: string;
    ip: string;
    country: string;
    now: Date;
    headersUserAgent: string | undefined;
  },
): PreparedEntry | { error: "forbidden" | "stale" | "meta_too_large" } {
  if (hasForbiddenFields(entry, context.source)) {
    return { error: "forbidden" };
  }
  const verdict = parseIngestTs(entry.ts as string | number | undefined, context.now);
  if (!verdict.ok) {
    return { error: "stale" };
  }
  const meta = entry.meta;
  if (metaSize(meta) > MAX_META_BYTES) {
    return { error: "meta_too_large" };
  }
  const message = cleanText(String(entry.message), MAX_MESSAGE_CHARS);
  const stack = cleanText(
    typeof entry.stack === "string" ? entry.stack : undefined,
    MAX_STACK_CHARS,
  );
  const level = String(entry.level) as LogLevel;
  const userAgent = cleanText(
    typeof entry.ua === "string" ? entry.ua : context.headersUserAgent,
    MAX_UA_CHARS,
  );
  const parsed = parseUserAgent(userAgent);
  const fp = ERROR_LEVELS.includes(level) ? fingerprint(message, stack) : "";
  const doc = {
    projectId: context.projectId,
    keyPrefix: context.keyPrefix,
    level,
    message,
    meta,
    stack,
    fingerprint: fp,
    count: 1,
    source: context.source,
    sessionId: cleanText(entry.sessionId as string | undefined, 80),
    pageId: cleanText(entry.pageId as string | undefined, 80),
    traceId: cleanText(entry.traceId as string | undefined, 80),
    requestId: cleanText(entry.requestId as string | undefined, 80),
    url: cleanText(entry.url as string | undefined, MAX_STRING_CHARS),
    route: cleanText(entry.route as string | undefined, 200),
    referrer: cleanText(entry.referrer as string | undefined, MAX_STRING_CHARS),
    ua: userAgent,
    browser: cleanText(parsed.browser, 80),
    os: cleanText(parsed.os, 80),
    device: cleanText(parsed.device, 40),
    viewport: cleanText(entry.viewport as string | undefined, 40),
    lang: cleanText(entry.lang as string | undefined, 40),
    tz: cleanText(entry.tz as string | undefined, 60),
    connection: cleanText(entry.connection as string | undefined, 40),
    ip: context.ip,
    country: context.country,
    appVersion: cleanText(entry.appVersion as string | undefined, 60),
    environment: cleanText(entry.environment as string | undefined, 40),
    release: cleanText(entry.release as string | undefined, 80),
    hostname: cleanText(entry.hostname as string | undefined, 120),
    pid: numberOrUndefined(entry.pid, 4_000_000),
    runtimeVersion: cleanText(entry.runtimeVersion as string | undefined, 60),
    rssMb: numberOrUndefined(entry.rssMb, 1_000_000),
    uptimeSec: numberOrUndefined(entry.uptimeSec, 1e9),
    durationMs: numberOrUndefined(entry.durationMs, 1e9),
    ts: verdict.ts,
    receivedAt: context.now,
  } as unknown as LogDoc;
  return { doc, fingerprint: fp };
}

function numberOrUndefined(value: unknown, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
    return undefined;
  }
  return value;
}

export async function ingestLogs(
  payload: unknown,
  context: IngestContext,
): Promise<IngestSummary> {
  const settings = await getSettings();
  if (!settings.ingestEnabled) {
    throw new IngestError("ingest_disabled", 403, "ingest is disabled");
  }
  if (!context.key.ingestEnabled) {
    throw new IngestError("ingest_disabled", 403, "ingest is disabled for project");
  }
  if (!kindCanWriteLogs(context.key.kind)) {
    throw new IngestError("unauthorized", 401, "invalid key");
  }
  const source = sourceForKind(context.key.kind);

  const perRequest = await enforceRateLimit(
    `ingest:logs:req:${context.key.keyId}`,
    INGEST_LIMITS.requestsPerMinute,
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

  const parsed = logIngestSchema.safeParse(payload);
  if (!parsed.success) {
    throw new IngestError(
      "invalid_payload",
      400,
      `invalid payload (${parsed.error.issues.length} issues)`,
    );
  }
  if (parsed.data.logs.length > settings.maxLogBatch) {
    throw new IngestError("batch_too_large", 400, "batch exceeds the configured cap");
  }

  const perHour = await enforceRateLimit(
    `ingest:logs:entries:${context.key.keyId}`,
    INGEST_LIMITS.entriesPerHour,
    3600,
    { durable: true },
  );
  if (!perHour.allowed) {
    throw new IngestError(
      "rate_limited",
      429,
      "hourly entry quota exceeded",
      perHour.retryAfterSeconds,
    );
  }

  const projectId = objectIdOrNull(context.key.projectId);
  if (projectId === null) {
    throw new IngestError("unauthorized", 401, "invalid key");
  }
  await connectToDatabase();
  const now = new Date();
  const headerUserAgent = context.headers.get("user-agent") ?? undefined;
  const prepared: LogDoc[] = [];
  const dedupe: LogDoc[] = [];
  let rejected = 0;
  let stale = 0;
  const counts = new Map<string, number>();

  for (const raw of parsed.data.logs) {
    const result = prepareEntry(raw as Record<string, unknown>, {
      projectId,
      source,
      keyPrefix: context.key.prefix,
      ip: cleanText(context.ip, 64),
      country: cleanText(context.country, 8).toUpperCase(),
      now,
      headersUserAgent: headerUserAgent,
    });
    if ("error" in result) {
      rejected += 1;
      if (result.error === "stale") {
        stale += 1;
      }
      continue;
    }
    if (result.fingerprint !== "") {
      const seen = counts.get(result.fingerprint);
      if (seen !== undefined) {
        const existing = dedupe.find((doc) => doc.fingerprint === result.fingerprint);
        if (existing !== undefined) {
          existing.count = (existing.count ?? 1) + 1;
          counts.set(result.fingerprint, seen + 1);
        }
        continue;
      }
      counts.set(result.fingerprint, 1);
      dedupe.push(result.doc);
      continue;
    }
    prepared.push(result.doc);
  }

  let stored = 0;
  let duplicates = 0;
  if (prepared.length > 0) {
    await LogModel.insertMany(prepared, { ordered: false });
    stored += prepared.length;
  }

  // Fingerprint dedupe in a constant number of round trips.
  //
  // Doing one findOneAndUpdate per unique fingerprint meant a 100-error batch issued up
  // to 200 serial queries; over a network (Atlas) that is seconds of latency per request.
  // Now: one query for every fingerprint in the batch, one bulkWrite for the hits, and
  // one insertMany for the misses.
  if (dedupe.length > 0) {
    const windowStart = new Date(now.getTime() - INGEST_LIMITS.groupWindowMs);
    const fingerprints = dedupe.map((doc) => doc.fingerprint);
    const existing = await LogModel.find(
      { projectId, fingerprint: { $in: fingerprints }, ts: { $gte: windowStart } },
      { fingerprint: 1, _id: 1 },
    )
      .lean()
      .exec();
    const existingByFingerprint = new Map<string, string>();
    for (const row of existing) {
      existingByFingerprint.set(row.fingerprint, String(row._id));
    }

    const increments: Parameters<typeof LogModel.bulkWrite>[0] = [];
    const inserts: LogDoc[] = [];
    for (const doc of dedupe) {
      const id = existingByFingerprint.get(doc.fingerprint);
      if (id === undefined) {
        inserts.push(doc);
        stored += 1;
        continue;
      }
      increments.push({
        updateOne: {
          filter: { _id: new Types.ObjectId(id) },
          update: {
            $inc: { count: doc.count },
            $max: { ts: doc.ts },
            $set: { receivedAt: now },
          },
        },
      });
      duplicates += doc.count;
    }

    if (increments.length > 0) {
      await LogModel.bulkWrite(increments, { ordered: false });
    }
    if (inserts.length > 0) {
      await LogModel.insertMany(inserts, { ordered: false });
    }
  }

  return {
    accepted: stored + duplicates,
    rejected,
    duplicates,
    stored,
    stale,
  }
}

export type LogQueryFilters = {
  levels?: readonly LogLevel[];
  source?: "client" | "server" | "all";
  environment?: string;
  release?: string;
  search?: string;
  sessionId?: string;
  traceId?: string;
  fingerprint?: string;
  since?: Date;
  until?: Date;
  cursor?: string;
  limit?: number;
  maxLimit?: number;
};

export type SerializedLog = {
  id: string;
  level: string;
  source: string;
  message: string;
  meta: unknown;
  stack: string;
  fingerprint: string;
  count: number;
  keyPrefix: string;
  sessionId: string;
  pageId: string;
  traceId: string;
  requestId: string;
  url: string;
  route: string;
  referrer: string;
  ua: string;
  browser: string;
  os: string;
  device: string;
  viewport: string;
  lang: string;
  tz: string;
  connection: string;
  ip: string;
  country: string;
  appVersion: string;
  environment: string;
  release: string;
  hostname: string;
  pid: number | null;
  runtimeVersion: string;
  rssMb: number | null;
  uptimeSec: number | null;
  durationMs: number | null;
  ts: string;
  receivedAt: string;
};

export type LogQueryResult = {
  logs: SerializedLog[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type LogGroup = {
  fingerprint: string;
  count: number;
  level: string;
  source: string;
  message: string;
  firstSeen: string;
  lastSeen: string;
  sample: SerializedLog;
  buckets: { hour: string; count: number }[];
};

export const DEFAULT_QUERY_LIMIT = 50;
export const MAX_QUERY_LIMIT = 200;
export const MAX_EXPORT_ROWS = 10_000;
const QUERY_MAX_TIME_MS = 5000;

export function encodeCursor(ts: Date, id: string): string {
  return Buffer.from(`${ts.getTime()}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): { ts: Date; id: mongoose.Types.ObjectId } | null {
  let raw: string;
  try {
    raw = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const separator = raw.indexOf("|");
  if (separator < 0) {
    return null;
  }
  const ms = Number(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  if (!Number.isFinite(ms) || !/^[a-f0-9]{24}$/i.test(id)) {
    return null;
  }
  return { ts: new Date(ms), id: new mongoose.Types.ObjectId(id) };
}

export function buildLogFilter(
  projectId: mongoose.Types.ObjectId,
  filters: LogQueryFilters,
): Record<string, unknown> {
  const filter: Record<string, unknown> = { projectId };
  if (filters.fingerprint !== undefined && filters.fingerprint !== "") {
    filter.fingerprint = filters.fingerprint;
  }
  if (filters.levels !== undefined && filters.levels.length > 0) {
    filter.level = { $in: [...filters.levels] };
  }
  if (filters.source !== undefined && filters.source !== "all") {
    filter.source = filters.source;
  }
  if (filters.environment !== undefined && filters.environment !== "") {
    filter.environment = filters.environment;
  }
  if (filters.release !== undefined && filters.release !== "") {
    filter.release = filters.release;
  }
  if (filters.sessionId !== undefined && filters.sessionId !== "") {
    filter.sessionId = filters.sessionId;
  }
  if (filters.traceId !== undefined && filters.traceId !== "") {
    filter.traceId = filters.traceId;
  }
  if (filters.search !== undefined && filters.search.trim() !== "") {
    const pattern = { $regex: escapeRegex(filters.search.trim()), $options: "i" };
    filter.$or = [
      { message: pattern },
      { stack: pattern },
      { route: pattern },
      { url: pattern },
      { traceId: pattern },
      { sessionId: pattern },
      { requestId: pattern },
    ];
  }
  if (filters.since !== undefined || filters.until !== undefined) {
    const range: Record<string, Date> = {};
    if (filters.since !== undefined) {
      range.$gte = filters.since;
    }
    if (filters.until !== undefined) {
      range.$lte = filters.until;
    }
    filter.ts = range;
  }
  if (filters.cursor !== undefined && filters.cursor !== "") {
    const decoded = decodeCursor(filters.cursor);
    if (decoded === null) {
      throw new IngestError("invalid_cursor", 400, "invalid cursor");
    }
    filter.$and = [
      {
        $or: [
          { ts: { $lt: decoded.ts } },
          { ts: decoded.ts, _id: { $lt: decoded.id } },
        ],
      },
    ];
  }
  return filter;
}

export function serializeLog(row: LogDoc & { _id: mongoose.Types.ObjectId }): SerializedLog {
  const value = row as unknown as Record<string, unknown>;
  const str = (key: string): string => {
    const raw = value[key];
    return typeof raw === "string" ? raw : "";
  };
  const num = (key: string): number | null => {
    const raw = value[key];
    return typeof raw === "number" ? raw : null;
  };
  const date = (key: string): string => {
    const raw = value[key];
    return raw instanceof Date ? raw.toISOString() : "";
  };
  const count = num("count");
  return {
    id: String(value._id),
    level: str("level"),
    source: str("source"),
    message: str("message"),
    meta: value.meta ?? null,
    stack: str("stack"),
    fingerprint: str("fingerprint"),
    count: count === null ? 1 : count,
    keyPrefix: str("keyPrefix"),
    sessionId: str("sessionId"),
    pageId: str("pageId"),
    traceId: str("traceId"),
    requestId: str("requestId"),
    url: str("url"),
    route: str("route"),
    referrer: str("referrer"),
    ua: str("ua"),
    browser: str("browser"),
    os: str("os"),
    device: str("device"),
    viewport: str("viewport"),
    lang: str("lang"),
    tz: str("tz"),
    connection: str("connection"),
    ip: str("ip"),
    country: str("country"),
    appVersion: str("appVersion"),
    environment: str("environment"),
    release: str("release"),
    hostname: str("hostname"),
    pid: num("pid"),
    runtimeVersion: str("runtimeVersion"),
    rssMb: num("rssMb"),
    uptimeSec: num("uptimeSec"),
    durationMs: num("durationMs"),
    ts: date("ts"),
    receivedAt: date("receivedAt"),
  };
}

export function resolveLimit(limit: number | undefined, max: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return Math.min(DEFAULT_QUERY_LIMIT, max);
  }
  return Math.min(Math.max(Math.trunc(limit), 1), max);
}

export async function queryLogs(
  projectId: string,
  filters: LogQueryFilters = {},
): Promise<LogQueryResult> {
  const id = objectIdOrNull(projectId);
  if (id === null) {
    return { logs: [], nextCursor: null, hasMore: false };
  }
  await connectToDatabase();
  const limit = resolveLimit(filters.limit, filters.maxLimit ?? MAX_QUERY_LIMIT);
  const filter = buildLogFilter(id, filters);
  const rows = await LogModel.find(filter)
    .sort({ ts: -1, _id: -1 })
    .limit(limit + 1)
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
  const page = rows.slice(0, limit) as (LogDoc & { _id: mongoose.Types.ObjectId })[];
  const last = page[page.length - 1];
  return {
    logs: page.map((row) => serializeLog(row)),
    nextCursor: last === undefined ? null : encodeCursor(last.ts, String(last._id)),
    hasMore: rows.length > limit,
  };
}

const COUNT_CACHE_TTL_MS = 10_000;
const COUNT_MAX_TIME_MS = 2000;
const countCache = new Map<string, { value: number; expiresAt: number }>();

export function resetLogCountCache(): void {
  countCache.clear();
}

/**
 * Exact row count for the current filter.
 *
 * countDocuments is proportional to matched rows, and the log viewer calls this on every
 * live-tail poll (~4s) as well as on each page render. It is now bounded by maxTimeMS and
 * memoised for a few seconds, so polling shows a slightly stale number instead of
 * re-scanning the collection. The count is display-only; the data itself is never cached.
 */
export async function countLogs(
  projectId: string,
  filters: LogQueryFilters = {},
  options: { maxTimeMS?: number } = {},
): Promise<number> {
  const id = objectIdOrNull(projectId);
  if (id === null) {
    return 0;
  }
  const cacheKey = `${id}:${stableFilterKey(filters)}`;
  const cached = countCache.get(cacheKey);
  if (cached !== undefined && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  await connectToDatabase();
  let value = 0;
  try {
    value = await LogModel.countDocuments(buildLogFilter(id, filters), {
      maxTimeMS: options.maxTimeMS ?? COUNT_MAX_TIME_MS,
    });
  } catch {
    // A count that runs long is a display problem, never a request failure.
    value = cached?.value ?? 0;
  }
  countCache.set(cacheKey, { value, expiresAt: Date.now() + COUNT_CACHE_TTL_MS });
  return value;
}

function stableFilterKey(filters: LogQueryFilters): string {
  return JSON.stringify({
    levels: [...(filters.levels ?? [])].sort(),
    source: filters.source ?? "all",
    environment: filters.environment ?? "",
    release: filters.release ?? "",
    search: filters.search ?? "",
    sessionId: filters.sessionId ?? "",
    traceId: filters.traceId ?? "",
    since: filters.since?.toISOString() ?? "",
    until: filters.until?.toISOString() ?? "",
  });
}

export async function logFacets(
  projectId: string,
): Promise<{ environments: string[]; releases: string[] }> {
  const id = objectIdOrNull(projectId);
  if (id === null) {
    return { environments: [], releases: [] };
  }
  await connectToDatabase();
  const [environments, releases] = await Promise.all([
    LogModel.distinct("environment", { projectId: id }) as Promise<unknown[]>,
    LogModel.distinct("release", { projectId: id }) as Promise<unknown[]>,
  ]);
  const clean = (values: unknown[]): string[] =>
    values
      .filter((value): value is string => typeof value === "string" && value !== "")
      .sort();
  return { environments: clean(environments), releases: clean(releases) };
}

export async function groupLogs(
  projectId: string,
  filters: LogQueryFilters = {},
): Promise<LogGroup[]> {
  const id = objectIdOrNull(projectId);
  if (id === null) {
    return [];
  }
  await connectToDatabase();
  const base = buildLogFilter(id, filters);
  base.fingerprint = { $ne: "" };
  delete base.$and;
  const limit = resolveLimit(filters.limit, MAX_QUERY_LIMIT);
  const summaries = await LogModel.aggregate<{
    _id: string;
    count: number;
    firstSeen: Date;
    lastSeen: Date;
    level: string;
    source: string;
    message: string;
  }>([
    { $match: base },
    {
      $group: {
        _id: "$fingerprint",
        count: { $sum: "$count" },
        firstSeen: { $min: "$ts" },
        lastSeen: { $max: "$ts" },
        level: { $first: "$level" },
        source: { $first: "$source" },
        message: { $first: "$message" },
      },
    },
    { $sort: { count: -1, lastSeen: -1 } },
    { $limit: limit },
  ]);

  if (summaries.length === 0) {
    return [];
  }

  const trends = await LogModel.aggregate<{
    _id: { fingerprint: string; hour: Date };
    count: number;
  }>([
    { $match: { ...base, fingerprint: { $in: summaries.map((row) => row._id) } } },
    {
      $group: {
        _id: {
          fingerprint: "$fingerprint",
          hour: { $dateTrunc: { date: "$ts", unit: "hour" } },
        },
        count: { $sum: "$count" },
      },
    },
  ]);
  const trendMap = new Map<string, Map<string, number>>();
  for (const trend of trends) {
    const fingerprint = trend._id.fingerprint;
    const hour = trend._id.hour instanceof Date ? trend._id.hour.toISOString() : String(trend._id.hour);
    const bucketMap = trendMap.get(fingerprint) ?? new Map<string, number>();
    bucketMap.set(hour, trend.count);
    trendMap.set(fingerprint, bucketMap);
  }

  const samples = await LogModel.find({
    projectId: id,
    fingerprint: { $in: summaries.map((row) => row._id) },
  })
    .sort({ ts: -1 })
    .lean();

  const sampleByFingerprint = new Map<string, LogDoc & { _id: mongoose.Types.ObjectId }>();
  for (const sample of samples as (LogDoc & { _id: mongoose.Types.ObjectId })[]) {
    if (!sampleByFingerprint.has(sample.fingerprint)) {
      sampleByFingerprint.set(sample.fingerprint, sample);
    }
  }

  return summaries.map((summary) => {
    const sample = sampleByFingerprint.get(summary._id);
    const bucketMap = trendMap.get(summary._id) ?? new Map<string, number>();
    const fallback: LogDoc & { _id: mongoose.Types.ObjectId } = {
      _id: new mongoose.Types.ObjectId(),
      fingerprint: summary._id,
      level: summary.level,
      source: summary.source,
      message: summary.message,
      count: summary.count,
    } as unknown as LogDoc & { _id: mongoose.Types.ObjectId };
    return {
      fingerprint: summary._id,
      count: summary.count,
      level: summary.level,
      source: summary.source,
      message: summary.message,
      firstSeen:
        summary.firstSeen instanceof Date
          ? summary.firstSeen.toISOString()
          : String(summary.firstSeen ?? ""),
      lastSeen:
        summary.lastSeen instanceof Date
          ? summary.lastSeen.toISOString()
          : String(summary.lastSeen ?? ""),
      sample: serializeLog(sample ?? fallback),
      buckets: [...bucketMap.entries()]
        .map(([hour, count]) => ({ hour, count }))
        .sort((a, b) => (a.hour < b.hour ? -1 : 1)),
    };
  });
}
