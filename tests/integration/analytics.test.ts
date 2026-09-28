import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import type { NextRequest } from "next/server";
import {
  clearDatabase,
  startTestDatabase,
  stopTestDatabase,
} from "@/tests/helpers/mongo";
import { authCookie, requestWithCookie } from "@/tests/helpers/request";
import { seedUser } from "@/tests/helpers/users";
import {
  OPTIONS as eventsOptions,
  POST as eventsPost,
} from "@/app/api/ingest/events/route";
import { GET as trackerGet } from "@/app/api/t.js/route";
import {
  GET as summaryGet,
  PATCH as summaryPatch,
} from "@/app/api/projects/[slug]/analytics/route";
import { GET as exportGet } from "@/app/api/projects/[slug]/analytics/export/route";
import { GET as overviewGet } from "@/app/api/analytics/route";
import { EventModel } from "@/lib/db/events";
import { ApiKeyModel } from "@/lib/db/apikeys";
import { AppSettingModel, DailyStatModel, RateLimitModel } from "@/lib/db/ops";
import { ProjectModel } from "@/lib/db/projects";
import { LogModel } from "@/lib/db/logs";
import { generateVerifiableApiKey } from "@/lib/keyManagement";
import { resetMemoryBuckets } from "@/lib/ratelimit";
import { MAX_BODY_BYTES } from "@/lib/validation";
import { TRACKER_SOURCE } from "@/lib/tracker";
import type { KeyKind } from "@/lib/db/apikeys";
import type { AnalyticsSummary } from "@/lib/analytics";

type Cookie = { name: string; value: string };

const ORIGIN = "http://localhost:3000";
const SLUG = "shop-demo";
const OWNER_EMAIL = "owner@example.com";
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const BOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

let ownerCookie: Cookie = { name: "", value: "" };
let projectId = "";
let analyticsKey = "";
let serverKey = "";

function slugContext(slug = SLUG): { params: Promise<{ slug: string }> } {
  return { params: Promise.resolve({ slug }) };
}

async function seedKey(kind: KeyKind, name: string): Promise<string> {
  const generated = generateVerifiableApiKey(kind);
  await ApiKeyModel.create({
    projectId: new mongoose.Types.ObjectId(projectId),
    name,
    kind,
    keyHash: generated.hash,
    prefix: generated.prefix,
  });
  return generated.key;
}

function eventsRequest(
  options: {
    key?: string | null;
    events?: unknown;
    rawBody?: string;
    contentType?: string | null;
    userAgent?: string;
    ip?: string;
    country?: string;
    origin?: string;
    query?: string;
  } = {},
): NextRequest {
  const headers = new Headers();
  const contentType =
    options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) {
    headers.set("content-type", contentType);
  }
  if (options.userAgent !== undefined) {
    headers.set("user-agent", options.userAgent);
  }
  if (options.ip !== undefined) {
    headers.set("x-forwarded-for", options.ip);
  }
  if (options.country !== undefined) {
    headers.set("x-vercel-ip-country", options.country);
  }
  if (options.origin !== undefined) {
    headers.set("origin", options.origin);
  }
  const body =
    options.rawBody ??
    JSON.stringify({
      ...(options.key === undefined ? {} : { key: options.key }),
      events: options.events ?? [{ type: "pageview", path: "/" }],
    });
  return requestWithCookie(
    `${ORIGIN}/api/ingest/events${options.query ?? ""}`,
    undefined,
    { method: "POST", headers, body },
  );
}

async function post(
  options: Parameters<typeof eventsRequest>[0] = {},
): Promise<Response> {
  return eventsPost(eventsRequest(options));
}

async function summary(query = "range=7d"): Promise<AnalyticsSummary> {
  const response = await summaryGet(
    requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/analytics?${query}`, ownerCookie),
    slugContext(),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as AnalyticsSummary;
}

beforeAll(async () => {
  await startTestDatabase();
});

afterAll(async () => {
  await stopTestDatabase();
});

afterEach(() => {
  resetMemoryBuckets();
});

beforeEach(async () => {
  await clearDatabase();
  resetMemoryBuckets();
  await seedUser({ email: OWNER_EMAIL, role: "ADMIN" });
  ownerCookie = await authCookie({ email: OWNER_EMAIL, role: "ADMIN" });
  const created = await mongoose.connection.collection("projects").insertOne({
    name: "Shop Demo",
    slug: SLUG,
    status: "live",
    ingestEnabled: true,
    analyticsEnabled: true,
    links: [{ type: "live", url: "https://shop.test" }],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  projectId = String(created.insertedId);
  analyticsKey = await seedKey("analytics", "tracker");
  serverKey = await seedKey("server", "api-worker");
});

describe("analytics storage", () => {
  it("keeps analytics indexes project-scoped and TTL-bound", async () => {
    await EventModel.syncIndexes();
    const entries = EventModel.schema.indexes() as [
      Record<string, number>,
      { expireAfterSeconds?: number },
    ][];
    const scoped = entries.filter(([, options]) => options.expireAfterSeconds === undefined);
    const ttl = entries.find(([, options]) => options.expireAfterSeconds !== undefined);
    expect(scoped.every(([spec]) => Object.keys(spec)[0] === "projectId")).toBe(true);
    expect(scoped.some(([spec]) => spec.ts !== undefined && spec._id !== undefined)).toBe(true);
    expect(ttl?.[1]).toMatchObject({ expireAfterSeconds: 60 * 60 * 24 * 90 });
  });
});

describe("analytics ingest authentication", () => {
  it("answers a request with no key at all with a generic 401", async () => {
    const response = await post({ key: null });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(await EventModel.countDocuments({})).toBe(0);
  });

  it("answers an unknown key with the same generic 401 and no detail", async () => {
    const response = await post({ key: "mak_totally-unknown-key-value-00" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("never leaks which part of the key was wrong", async () => {
    const response = await post({ key: `${analyticsKey.slice(0, -4)}zzzz` });
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).toBe('{"error":"unauthorized"}');
  });

  it("rejects a revoked key", async () => {
    await ApiKeyModel.updateMany({}, { $set: { revokedAt: new Date() } });
    const response = await post({ key: analyticsKey });
    expect(response.status).toBe(401);
  });

  it("refuses a server kind key because analytics keys are the only kind allowed", async () => {
    const response = await post({ key: serverKey, events: [{ type: "pageview", path: "/x" }] });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(await EventModel.countDocuments({})).toBe(0);
  });

  it("refuses a key supplied in a query string", async () => {
    const response = await post({ key: null, query: `?key=${analyticsKey}` });
    expect(response.status).toBe(401);
    expect(await EventModel.countDocuments({})).toBe(0);
  });

  it("allows an analytics key and stamps every server derived field itself", async () => {
    const now = Date.now();
    const response = await post({
      key: analyticsKey,
      ip: "203.0.113.9, 10.0.0.1",
      country: "de",
      userAgent: CHROME,
      events: [
        {
          type: "pageview",
          path: "/pricing",
          referrer: "https://news.example/post",
          utm: { source: "newsletter", medium: "email" },
          ts: now,
        },
        { type: "click", name: "[/pricing] Buy now (#buy)", path: "/pricing" },
        { type: "custom", name: "signup_clicked", props: { plan: "pro" } },
      ],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: 3,
      rejected: 0,
      stored: 3,
      stale: 0,
      bots: 0,
    });
    const rows = (await EventModel.find({}).sort({ type: 1 }).lean()) as unknown as Record<
      string,
      unknown
    >[];
    const pageview = rows.find((row) => row.type === "pageview");
    expect(pageview?.ip).toBe("203.0.113.9");
    expect(pageview?.country).toBe("DE");
    expect(pageview?.keyPrefix).toBe(analyticsKey.slice(0, 7));
    expect(String(pageview?.visitorId)).toHaveLength(32);
    expect(pageview?.browser).toBe("Chrome");
    expect(pageview?.device).toBe("desktop");
    expect(pageview?.referrer).toBe("https://news.example/post");
    expect(pageview?.utm).toEqual({ source: "newsletter", medium: "email" });
    expect(pageview?.receivedAt).toBeInstanceOf(Date);
    const custom = rows.find((row) => row.type === "custom");
    expect(custom?.props).toEqual({ plan: "pro" });
  });
});

describe("analytics ingest hardening", () => {
  it("rejects a non JSON content type with 415", async () => {
    const response = await post({
      key: analyticsKey,
      contentType: "text/plain;charset=UTF-8",
      rawBody: JSON.stringify({ key: analyticsKey, events: [] }),
    });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "unsupported_media_type" });
    expect(await EventModel.countDocuments({})).toBe(0);
  });

  it("rejects an oversized body with 413 before anything is stored", async () => {
    const response = await post({
      key: analyticsKey,
      rawBody: JSON.stringify({
        key: analyticsKey,
        events: [{ type: "pageview", path: `/${"x".repeat(MAX_BODY_BYTES + 100)}` }],
      }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
    expect(await EventModel.countDocuments({})).toBe(0);
  });

  it("rejects a batch over the configured cap", async () => {
    await AppSettingModel.create({ key: "ingest.maxEventBatch", value: 2 });
    const response = await post({
      key: analyticsKey,
      events: [
        { type: "pageview", path: "/a" },
        { type: "pageview", path: "/b" },
        { type: "pageview", path: "/c" },
      ],
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "batch_too_large" });
    expect(await EventModel.countDocuments({})).toBe(0);
  });

  it("rejects a batch over the hard schema cap", async () => {
    const response = await post({
      key: analyticsKey,
      events: Array.from({ length: 101 }, (_unused, index) => ({
        type: "pageview",
        path: `/p${index}`,
      })),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_payload" });
  });

  it("rejects a forged server derived field in any event of the batch", async () => {
    for (const field of ["source", "ip", "visitorId", "country", "device", "keyPrefix"]) {
      const response = await post({
        key: analyticsKey,
        events: [{ type: "pageview", path: "/forged", [field]: "1.2.3.4" }],
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_payload" });
    }
    expect(await EventModel.countDocuments({})).toBe(0);
  });

  it("drops replayed and forged client clocks and reports them", async () => {
    const now = Date.now();
    const response = await post({
      key: analyticsKey,
      userAgent: CHROME,
      events: [
        { type: "pageview", path: "/fresh", ts: now },
        { type: "pageview", path: "/ancient", ts: now - 25 * 60 * 60 * 1000 },
        { type: "pageview", path: "/future", ts: now + 20 * 60 * 1000 },
        { type: "pageview", path: "/no_clock" },
      ],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: 2,
      rejected: 2,
      stored: 2,
      stale: 2,
      bots: 0,
    });
    const paths = (await EventModel.find({}).lean()).map((row) => row.path).sort();
    expect(paths).toEqual(["/fresh", "/no_clock"]);
  });

  it("drops bots at ingest and counts them without storing anything", async () => {
    const response = await post({
      key: analyticsKey,
      userAgent: BOT,
      events: [
        { type: "pageview", path: "/bot" },
        { type: "pageview", path: "/bot-too" },
      ],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: 0,
      rejected: 2,
      stored: 0,
      stale: 0,
      bots: 2,
    });
    expect(await EventModel.countDocuments({})).toBe(0);
    const summaryData = await summary("range=today");
    expect(summaryData.totals.pageviews).toBe(0);
    expect(summaryData.totals.visitors).toBe(0);
    expect(summaryData.totals.activeNow).toBe(0);
  });

  it("rejects a cross site origin but allows the project host and its subdomains", async () => {
    const hostile = await post({
      key: analyticsKey,
      origin: "https://evil.test",
      userAgent: CHROME,
    });
    expect(hostile.status).toBe(403);
    expect(await hostile.json()).toEqual({ error: "cross_site" });
    expect(await EventModel.countDocuments({})).toBe(0);

    const allowed = await post({
      key: analyticsKey,
      origin: "https://app.shop.test",
      userAgent: CHROME,
      events: [{ type: "pageview", path: "/from-site" }],
    });
    expect(allowed.status).toBe(200);

    const unattributed = await post({
      key: analyticsKey,
      origin: "null",
      userAgent: CHROME,
      events: [{ type: "pageview", path: "/sandboxed" }],
    });
    expect(unattributed.status).toBe(200);
  });

  it("honours the global kill switch", async () => {
    await AppSettingModel.create({ key: "ingest.analyticsEnabled", value: false });
    const response = await post({ key: analyticsKey });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "analytics_disabled" });
    expect(await EventModel.countDocuments({})).toBe(0);
  });

  it("honours the per project kill switch", async () => {
    await ProjectModel.updateOne({ slug: SLUG }, { $set: { analyticsEnabled: false } });
    const response = await post({ key: analyticsKey });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "analytics_disabled" });
    expect(await EventModel.countDocuments({})).toBe(0);
  });

  it("returns 429 with Retry-After once the per key quota is spent", async () => {
    const keyRow = await ApiKeyModel.findOne({ prefix: analyticsKey.slice(0, 7) }).lean();
    const keyId = String(keyRow?._id);
    const windowStart = new Date(Math.floor(Date.now() / 60000) * 60000);
    await RateLimitModel.create({
      key: `ingest:events:req:${keyId}`,
      windowStart,
      count: 500,
    });
    const response = await post({ key: analyticsKey });
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const retryAfter = Number(response.headers.get("retry-after") ?? "0");
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(await response.json()).toMatchObject({ error: "rate_limited" });
    expect(await EventModel.countDocuments({})).toBe(0);

    const other = await post({ key: serverKey, query: "" }).catch(() => null);
    void other;
    expect(await EventModel.countDocuments({})).toBe(0);
  });

  it("caps the hourly event quota separately from the request quota", async () => {
    const keyRow = await ApiKeyModel.findOne({ prefix: analyticsKey.slice(0, 7) }).lean();
    const keyId = String(keyRow?._id);
    const windowStart = new Date(Math.floor(Date.now() / 3600000) * 3600000);
    await RateLimitModel.create({
      key: `ingest:events:hour:${keyId}`,
      windowStart,
      count: 5000,
    });
    const response = await post({ key: analyticsKey });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "rate_limited" });
    expect(await EventModel.countDocuments({})).toBe(0);
  });

  it("restricts CORS to POST and OPTIONS without credentials", async () => {
    const options = await eventsOptions();
    expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-origin")).toBe("*");
    expect(options.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(options.headers.get("access-control-allow-headers")).toBe("content-type");
    expect(options.headers.get("access-control-allow-credentials")).toBeNull();
    const response = await post({ key: analyticsKey, userAgent: CHROME });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a malformed body", async () => {
    const response = await post({ key: analyticsKey, rawBody: "{not json" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_payload" });
  });
});

describe("analytics summary authorization", () => {
  it("requires a session", async () => {
    const response = await summaryGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/analytics?range=7d`, undefined),
      slugContext(),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 403 when analytics.view is denied", async () => {
    await seedUser({
      email: "reader@example.com",
      role: "USER",
      overrides: { "analytics.view": "deny" },
    });
    const reader = await authCookie({ email: "reader@example.com", role: "USER" });
    const response = await summaryGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/analytics?range=7d`, reader),
      slugContext(),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 404 for an unknown project", async () => {
    const response = await summaryGet(
      requestWithCookie(`${ORIGIN}/api/projects/nope/analytics`, ownerCookie),
      slugContext("nope"),
    );
    expect(response.status).toBe(404);
  });

  it("rejects an invalid range instead of silently defaulting", async () => {
    const response = await summaryGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/analytics?range=99y`, ownerCookie),
      slugContext(),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_range" });
  });

  it("never lets a direct api call bypass the hidden toggle", async () => {
    await seedUser({ email: "reader@example.com", role: "USER" });
    const reader = await authCookie({ email: "reader@example.com", role: "USER" });
    const response = await summaryPatch(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/analytics`, reader, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyticsEnabled: false }),
      }),
      slugContext(),
    );
    expect(response.status).toBe(403);
    expect((await ProjectModel.findOne({ slug: SLUG }).lean())?.analyticsEnabled).toBe(true);
  });
});

describe("analytics rollups and live counts", () => {
  beforeEach(async () => {
    await post({
      key: analyticsKey,
      ip: "203.0.113.20",
      userAgent: CHROME,
      events: [
        {
          type: "pageview",
          path: "/",
          referrer: "https://google.com/",
          utm: { source: "newsletter" },
        },
        { type: "pageview", path: "/pricing" },
        { type: "click", name: "[/pricing] Buy now (#buy)", path: "/pricing" },
        { type: "custom", name: "signup_clicked" },
      ],
    });
  });

  it("accumulates totals, breakdowns and a dense daily series", async () => {
    const data = await summary("range=7d");
    expect(data.totals).toMatchObject({
      pageviews: 2,
      visitors: 1,
      clicks: 1,
      customEvents: 1,
    });
    expect(data.totals.activeNow).toBe(1);
    expect(data.topPages).toEqual([
      { name: "/", count: 1 },
      { name: "/pricing", count: 1 },
    ]);
    expect(data.entryPages).toEqual([{ name: "/", count: 1 }]);
    expect(data.referrers).toEqual([{ name: "https://google.com/", count: 1 }]);
    expect(data.sources).toEqual([{ name: "newsletter", count: 1 }]);
    expect(data.utm).toEqual([{ source: "newsletter", medium: "", campaign: "", count: 1 }]);
    expect(data.clicks).toEqual([{ name: "[/pricing] Buy now (#buy)", count: 1 }]);
    expect(data.customEvents).toEqual([{ name: "signup_clicked", count: 1 }]);
    expect(data.browsers).toEqual([{ name: "Chrome", count: 4 }]);
    expect(data.devices).toEqual([{ name: "desktop", count: 4 }]);
    expect(data.series).toHaveLength(7);
    const today = data.series[data.series.length - 1];
    expect(today?.pageviews).toBe(2);
    expect(today?.visitors).toBe(1);
    expect(data.days).toBe(7);
    expect(data.timezone).toBe("UTC");
    expect(await DailyStatModel.countDocuments({ projectId })).toBe(1);
  });

  it("keeps accumulating after a second ingest without double counting the day", async () => {
    await post({
      key: analyticsKey,
      ip: "203.0.113.20",
      userAgent: CHROME,
      events: [
        { type: "pageview", path: "/" },
        { type: "pageview", path: "/docs" },
        { type: "click", name: "[/] Nav (#nav)", path: "/" },
      ],
    });
    const data = await summary("range=today");
    expect(data.totals).toMatchObject({
      pageviews: 4,
      visitors: 1,
      clicks: 2,
      customEvents: 1,
    });
    expect(data.topPages).toEqual([
      { name: "/", count: 2 },
      { name: "/docs", count: 1 },
      { name: "/pricing", count: 1 },
    ]);
    expect(data.series).toHaveLength(1);
    expect(await DailyStatModel.countDocuments({ projectId })).toBe(1);
  });

  it("counts a second visitor separately and reflects the live window", async () => {
    await post({
      key: analyticsKey,
      ip: "198.51.100.7",
      userAgent: CHROME,
      events: [{ type: "pageview", path: "/" }],
    });
    const data = await summary("range=today");
    expect(data.totals.visitors).toBe(2);
    expect(data.totals.activeNow).toBe(2);
    expect(data.totals.pageviews).toBe(3);
  });

  it("keeps active now empty for events older than the live window", async () => {
    await EventModel.updateMany({}, { $set: { ts: new Date(Date.now() - 30 * 60_000) } });
    const data = await summary("range=7d");
    expect(data.totals.visitors).toBe(1);
    expect(data.totals.pageviews).toBe(2);
    expect(data.totals.activeNow).toBe(0);
  });

  it("excludes older days from a custom range", async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    await EventModel.updateMany(
      { type: "pageview", path: "/" },
      { $set: { ts: new Date(yesterday.getTime() - 1000) } },
    );
    const from = yesterday.toISOString().slice(0, 10);
    const data = await summary(`range=custom&from=${from}&to=${from}`);
    expect(data.days).toBe(1);
    expect(data.totals.pageviews).toBe(0);
  });
});

describe("analytics cross project overview", () => {
  it("aggregates every project and links into each one", async () => {
    await post({
      key: analyticsKey,
      ip: "203.0.113.20",
      userAgent: CHROME,
      events: [{ type: "pageview", path: "/a" }, { type: "pageview", path: "/b" }],
    });
    const response = await overviewGet(
      requestWithCookie(`${ORIGIN}/api/analytics?range=7d`, ownerCookie),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = (await response.json()) as {
      totals: { pageviews: number };
      projects: { slug: string; pageviews: number; analyticsEnabled: boolean }[];
      series: unknown[];
    };
    expect(payload.totals.pageviews).toBe(2);
    expect(payload.projects).toHaveLength(1);
    expect(payload.projects[0]?.slug).toBe(SLUG);
    expect(payload.projects[0]?.pageviews).toBe(2);
    expect(payload.projects[0]?.analyticsEnabled).toBe(true);
    expect(payload.series).toHaveLength(7);
  });

  it("requires a session and analytics.view", async () => {
    const anonymous = await overviewGet(requestWithCookie(`${ORIGIN}/api/analytics`, undefined));
    expect(anonymous.status).toBe(401);
    await seedUser({
      email: "reader@example.com",
      role: "USER",
      overrides: { "analytics.view": "deny" },
    });
    const reader = await authCookie({ email: "reader@example.com", role: "USER" });
    const denied = await overviewGet(
      requestWithCookie(`${ORIGIN}/api/analytics`, reader),
    );
    expect(denied.status).toBe(403);
  });
});

describe("analytics ingest toggle and export", () => {
  it("turns analytics ingest off through analytics.edit only", async () => {
    await seedUser({ email: "reader@example.com", role: "USER" });
    const reader = await authCookie({ email: "reader@example.com", role: "USER" });
    const denied = await summaryPatch(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/analytics`, reader, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyticsEnabled: false }),
      }),
      slugContext(),
    );
    expect(denied.status).toBe(403);

    const allowed = await summaryPatch(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/analytics`, ownerCookie, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyticsEnabled: false }),
      }),
      slugContext(),
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ analyticsEnabled: false });
    expect(allowed.headers.get("cache-control")).toBe("no-store");

    const blocked = await post({ key: analyticsKey, userAgent: CHROME });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toEqual({ error: "analytics_disabled" });
  });

  it("validates the toggle body", async () => {
    const response = await summaryPatch(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/analytics`, ownerCookie, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyticsEnabled: "yes" }),
      }),
      slugContext(),
    );
    expect(response.status).toBe(400);
  });

  it("exports events as a formula safe csv behind analytics.export", async () => {
    await post({
      key: analyticsKey,
      ip: "203.0.113.30",
      userAgent: CHROME,
      country: "GB",
      events: [
        { type: "custom", name: "=checkout", props: { plan: "pro" } },
        { type: "pageview", path: "/done", referrer: "https://google.com/" },
      ],
    });
    await seedUser({ email: "reader@example.com", role: "USER" });
    const reader = await authCookie({ email: "reader@example.com", role: "USER" });
    const denied = await exportGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/analytics/export?format=csv`, reader),
      slugContext(),
    );
    expect(denied.status).toBe(403);

    await seedUser({ email: "dev@example.com", role: "DEVELOPER" });
    const dev = await authCookie({ email: "dev@example.com", role: "DEVELOPER" });
    const devDenied = await exportGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/analytics/export?format=csv`, dev),
      slugContext(),
    );
    expect(devDenied.status).toBe(403);

    await seedUser({
      email: "dev-allow@example.com",
      role: "DEVELOPER",
      overrides: { "analytics.export": "allow" },
    });
    const devAllowed = await authCookie({
      email: "dev-allow@example.com",
      role: "DEVELOPER",
    });
    const stillDenied = await exportGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/analytics/export?format=csv`, devAllowed),
      slugContext(),
    );
    expect(stillDenied.status).toBe(403);

    const response = await exportGet(
      requestWithCookie(
        `${ORIGIN}/api/projects/${SLUG}/analytics/export?format=csv&range=7d`,
        ownerCookie,
      ),
      slugContext(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("x-row-count")).toBe("2");
    expect(response.headers.get("x-row-cap")).toBe("10000");
    const body = await response.text();
    expect(body).toContain("'=checkout");
    expect(body.split("\n")).toHaveLength(3);

    const json = await exportGet(
      requestWithCookie(
        `${ORIGIN}/api/projects/${SLUG}/analytics/export?format=json&range=7d`,
        ownerCookie,
      ),
      slugContext(),
    );
    expect(json.headers.get("content-type")).toContain("application/json");
    const payload = (await json.json()) as { events: { props: unknown }[] };
    expect(payload.events).toHaveLength(2);
    expect(payload.events.some((event) => event.props !== null)).toBe(true);
  });

  it("requires a session for the export and 404s an unknown project", async () => {
    const anonymous = await exportGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/analytics/export`, undefined),
      slugContext(),
    );
    expect(anonymous.status).toBe(401);
    const missing = await exportGet(
      requestWithCookie(`${ORIGIN}/api/projects/nope/analytics/export`, ownerCookie),
      slugContext("nope"),
    );
    expect(missing.status).toBe(404);
  });
});

describe("tracker script delivery", () => {
  function trackerRequest(query = ""): NextRequest {
    return requestWithCookie(`${ORIGIN}/t.js${query}`, undefined);
  }

  it("serves the tracker as immutable javascript without a session", async () => {
    const response = await trackerGet(trackerRequest("?v=1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/javascript");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("etag")).toMatch(/^"mgr-tjs-1-[a-f0-9]{16}"$/);
    const body = await response.text();
    expect(body).toBe(TRACKER_SOURCE);
    expect(body).toContain("window.__mgr = function");
  });

  it("answers a matching etag with 304", async () => {
    const first = await trackerGet(trackerRequest());
    const etag = first.headers.get("etag") ?? "";
    const second = await trackerGet(
      requestWithCookie(`${ORIGIN}/t.js`, undefined, { headers: { "if-none-match": etag } }),
    );
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    const stale = await trackerGet(
      requestWithCookie(`${ORIGIN}/t.js`, undefined, {
        headers: { "if-none-match": '"mgr-tjs-0-deadbeefdeadbeef"' },
      }),
    );
    expect(stale.status).toBe(200);
  });

  it("never puts a key in a query string anywhere in the served source", async () => {
    const body = await (await trackerGet(trackerRequest())).text();
    expect(body).not.toContain("mak_");
    expect(body).not.toMatch(/[?&]key=/);
    expect(body).toContain('JSON.stringify({ key: key, events: batch })');
    expect(body).not.toMatch(/eval\s*\(/);
    expect(body).not.toContain("new Function");
    expect(body).not.toContain("innerHTML");
    expect(body).not.toContain("document.write");
  });
});

describe("tracker key never reaches a log", () => {
  it("keeps the two ingest surfaces apart", async () => {
    const { POST: logsPost } = await import("@/app/api/ingest/logs/route");
    const logs = await logsPost(
      requestWithCookie(`${ORIGIN}/api/ingest/logs`, undefined, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": analyticsKey },
        body: JSON.stringify({ logs: [{ level: "info", message: "from analytics key" }] }),
      }),
    );
    expect(logs.status).toBe(401);
    expect(await LogModel.countDocuments({})).toBe(0);

    const events = await post({
      key: analyticsKey,
      userAgent: CHROME,
      events: [{ type: "pageview", path: "/only-events" }],
    });
    expect(events.status).toBe(200);
    expect(await LogModel.countDocuments({})).toBe(0);
  });
});
