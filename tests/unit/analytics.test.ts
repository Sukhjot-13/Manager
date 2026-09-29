import { gzipSync } from "node:zlib";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  clearDatabase,
  startTestDatabase,
  stopTestDatabase,
} from "@/tests/helpers/mongo";
import {
  EVENT_EXPORT_COLUMNS,
  EVENT_SERVER_DERIVED_FIELDS,
  alignSeries,
  analyticsSummary,
  cleanCountry,
  cleanUtm,
  combineSeries,
  hasForbiddenEventFields,
  hostsFromLinks,
  mergeCountMaps,
  originCheck,
  prepareEvent,
  rankCounts,
  resolveRange,
  rollupKeySafe,
  serializeEvent,
  sumSeries,
  MAX_PATH_CHARS,
  UTM_FIELDS,
  type SeriesPoint,
} from "@/lib/analytics";
import { IngestError } from "@/lib/ingest";
import { localDayStartUtc, rangeDates, rollupDay, type DailyRollup } from "@/lib/rollup";
import { EventModel } from "@/lib/db/events";
import { DailyStatModel } from "@/lib/db/ops";
import { ProjectModel } from "@/lib/db/projects";
import { escapeCsvCell, toCsv } from "@/lib/csv";
import { MAX_META_BYTES, MAX_TS_AGE_MS, MAX_TS_FUTURE_MS } from "@/lib/validation";
import { addDays, dailyWindowStart, isBot, utcDateKey, visitorId } from "@/lib/visitor";
import { parseUserAgent } from "@/lib/ua";
import { TRACKER_SOURCE, TRACKER_VERSION, getEmbedSnippet } from "@/lib/tracker";

const PEPPER = "unit-visitor-pepper";
const DAY_ONE = new Date("2026-03-10T10:00:00.000Z");
const DAY_TWO = new Date("2026-03-11T10:00:00.000Z");
const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

let projectId = "";

beforeAll(async () => {
  await startTestDatabase();
});

afterAll(async () => {
  await stopTestDatabase();
});

beforeEach(async () => {
  await clearDatabase();
  const created = await ProjectModel.create({
    name: "Unit Site",
    slug: "unit-site",
    status: "live",
    ingestEnabled: true,
    analyticsEnabled: true,
  });
  projectId = String(created._id);
});

function projectObjectId(): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(projectId);
}

function counts(value: unknown): Record<string, number> {
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

function eventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projectId: projectObjectId(),
    keyPrefix: "mak_abc",
    type: "pageview",
    name: "unit-site",
    path: "/",
    visitorId: "v1",
    sessionId: "s1",
    referrer: "",
    device: "desktop",
    browser: "Chrome",
    os: "Mac OS",
    country: "CA",
    ip: "203.0.113.4",
    rejected: false,
    ts: new Date(),
    receivedAt: new Date(),
    ...overrides,
  };
}

describe("visitor ids", () => {
  it("is stable for the same ip, user agent, pepper and day", () => {
    const first = visitorId("203.0.113.4", CHROME, PEPPER, DAY_ONE);
    const later = visitorId("203.0.113.4", CHROME, PEPPER, new Date("2026-03-10T23:59:59.000Z"));
    expect(first).toBe(later);
    expect(first).toHaveLength(32);
    expect(first).toMatch(/^[a-f0-9]{32}$/);
  });

  it("rotates every day so a returning visitor is not linkable", () => {
    expect(visitorId("203.0.113.4", CHROME, PEPPER, DAY_ONE)).not.toBe(
      visitorId("203.0.113.4", CHROME, PEPPER, DAY_TWO),
    );
    expect(visitorId("203.0.113.4", CHROME, PEPPER, DAY_ONE)).not.toBe(
      visitorId("203.0.113.4", CHROME, PEPPER, addDays(DAY_ONE, -1)),
    );
  });

  it("changes completely when the pepper rotates", () => {
    expect(visitorId("203.0.113.4", CHROME, PEPPER, DAY_ONE)).not.toBe(
      visitorId("203.0.113.4", CHROME, "rotated-pepper", DAY_ONE),
    );
  });

  it("separates different addresses and agents", () => {
    expect(visitorId("203.0.113.4", CHROME, PEPPER, DAY_ONE)).not.toBe(
      visitorId("203.0.113.5", CHROME, PEPPER, DAY_ONE),
    );
    expect(visitorId("203.0.113.4", CHROME, PEPPER, DAY_ONE)).not.toBe(
      visitorId("203.0.113.4", IPHONE, PEPPER, DAY_ONE),
    );
  });

  it("handles an unknown ip and user agent without throwing", () => {
    const unknown = visitorId("", "", PEPPER, DAY_ONE);
    expect(unknown).toMatch(/^[a-f0-9]{32}$/);
    expect(unknown).toBe(visitorId("", "", PEPPER, DAY_ONE));
    expect(unknown).not.toBe(visitorId("", "", PEPPER, DAY_TWO));
    const withAgent = visitorId("", CHROME, PEPPER, DAY_ONE);
    expect(withAgent).not.toBe(unknown);
  });

  it("derives an id server side even when the payload carries none", () => {
    const prepared = prepareEvent(
      { type: "pageview", path: "/pricing" },
      {
        projectId: projectObjectId(),
        keyPrefix: "mak_abc",
        ip: "203.0.113.9",
        country: "us",
        now: DAY_ONE,
        headerUserAgent: CHROME,
      },
    );
    expect("doc" in prepared).toBe(true);
    if (!("doc" in prepared)) {
      return;
    }
    const value = prepared.doc as unknown as Record<string, unknown>;
    expect(value.visitorId).toBe(
      visitorId("203.0.113.9", CHROME, process.env.VISITOR_PEPPER ?? "", DAY_ONE),
    );
    expect(value.path).toBe("/pricing");
    expect(value.device).toBe("desktop");
    expect(value.country).toBe("US");
    expect(value.ts).toEqual(DAY_ONE);
  });
});

describe("bot filtering", () => {
  const table: [string, boolean][] = [
    [CHROME, false],
    [IPHONE, false],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/143.0", false],
    ["", true],
    ["   ", true],
    ["Googlebot/2.1 (+http://www.google.com/bot.html)", true],
    ["Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)", true],
    ["Mozilla/5.0 (compatible; YandexBot/3.0)", true],
    ["Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/140.0.0.0", true],
    ["python-requests/2.32.3", true],
    ["curl/8.4.0", true],
    ["Go-http-client/1.1", true],
    ["Mozilla/5.0 (compatible; Uptime-Kuma/1.0)", true],
  ];

  for (const [userAgent, expected] of table) {
    it(`${expected ? "drops" : "keeps"} ${JSON.stringify(userAgent.slice(0, 48))}`, () => {
      expect(isBot(userAgent)).toBe(expected);
    });
  }

  it("is decided by the request user agent, never by a payload field", () => {
    const botWithSpoofedBrowser = prepareEvent(
      { type: "pageview", path: "/", ua: CHROME },
      {
        projectId: projectObjectId(),
        keyPrefix: "mak_abc",
        ip: "203.0.113.9",
        country: "",
        now: new Date(),
        headerUserAgent: "Googlebot/2.1 (+http://www.google.com/bot.html)",
      },
    );
    expect(botWithSpoofedBrowser).toEqual({ error: "bot" });
    const humanWithoutHeader = prepareEvent(
      { type: "pageview", path: "/", ua: CHROME },
      {
        projectId: projectObjectId(),
        keyPrefix: "mak_abc",
        ip: "203.0.113.9",
        country: "",
        now: new Date(),
        headerUserAgent: undefined,
      },
    );
    expect("doc" in humanWithoutHeader).toBe(true);
  });
});

describe("range boundaries", () => {
  it("covers today as one utc day", () => {
    const today = rangeDates("today", undefined, undefined);
    expect(utcDateKey(today.start)).toBe(utcDateKey(dailyWindowStart()));
    expect(today.end.getTime() - today.start.getTime()).toBe(86_400_000);
  });

  it("covers seven and thirty inclusive days ending today", () => {
    const seven = rangeDates("7d", undefined, undefined);
    const thirty = rangeDates("30d", undefined, undefined);
    expect(seven.end.getTime() - seven.start.getTime()).toBe(7 * 86_400_000);
    expect(thirty.end.getTime() - thirty.start.getTime()).toBe(30 * 86_400_000);
    expect(thirty.start.getTime()).toBeLessThan(seven.start.getTime());
  });

  it("resolves local midnight against the display timezone, not blindly UTC", () => {
    // 2026-09-29T02:00Z is still 2026-09-28 in New York (UTC-4). Buckets stay UTC-keyed;
    // only the window the dashboard asks for moves.
    const at = new Date("2026-09-29T02:00:00.000Z");
    expect(localDayStartUtc(at, "UTC").toISOString()).toBe("2026-09-29T00:00:00.000Z");
    expect(localDayStartUtc(at, "America/New_York").toISOString()).toBe("2026-09-28T04:00:00.000Z");
    expect(localDayStartUtc(at, "Asia/Kolkata").toISOString()).toBe("2026-09-28T18:30:00.000Z");
    expect(localDayStartUtc(at, "Not/AZone").toISOString()).toBe("2026-09-29T00:00:00.000Z");

    // A day window is always exactly 24h, whatever the offset, and today is never empty.
    for (const zone of ["UTC", "America/New_York", "Asia/Kolkata", "Pacific/Kiritimati"]) {
      const start = localDayStartUtc(at, zone);
      expect((start.getTime() + 86_400_000 - start.getTime()) / 86_400_000).toBe(1);
      expect(start.getTime()).toBeLessThanOrEqual(at.getTime());
      const today = rangeDates("today", undefined, undefined, zone);
      expect((today.end.getTime() - today.start.getTime()) / 86_400_000).toBe(1);
      expect(today.start.getTime()).toBeLessThanOrEqual(Date.now());
    }
  });

  it("makes a custom range inclusive of the end day", () => {
    const custom = rangeDates(
      "custom",
      new Date("2026-02-01T13:30:00.000Z"),
      new Date("2026-02-05T02:00:00.000Z"),
    );
    expect(utcDateKey(custom.start)).toBe("2026-02-01");
    expect(utcDateKey(custom.end)).toBe("2026-02-06");
    expect(custom.end.getTime() - custom.start.getTime()).toBe(5 * 86_400_000);
  });

  it("resolves ranges through the shared query schema and rejects junk", () => {
    const resolved = resolveRange({ range: "30d" });
    expect(resolved.range).toBe("30d");
    expect(resolved.days).toBe(30);
    const custom = resolveRange({ range: "custom", from: "2026-02-01", to: "2026-02-05" });
    expect(custom.days).toBe(5);
    expect(resolveRange({}).range).toBe("7d");
    expect(() => resolveRange({ range: "90d" })).toThrow(IngestError);
    expect(() => resolveRange({ range: "custom", from: "not-a-date" })).toThrow(IngestError);
  });
});

describe("daily rollup aggregation", () => {
  async function seedDay(): Promise<string> {
    const rows = [
      eventRow({ visitorId: "v1", path: "/", referrer: "https://google.com/", utm: undefined }),
      eventRow({
        visitorId: "v1",
        path: "/pricing",
        referrer: "https://google.com/",
        utm: { source: "newsletter", medium: "email" },
      }),
      eventRow({ visitorId: "v2", path: "/", referrer: "https://x-com/", utm: undefined }),
      eventRow({
        visitorId: "v2",
        type: "click",
        name: "[/pricing] Buy now (#buy)",
        path: "/pricing",
        referrer: "",
        utm: undefined,
        browser: "Safari",
        country: "DE",
      }),
      eventRow({
        visitorId: "v3",
        type: "custom",
        name: "signup_clicked",
        path: "/",
        referrer: "",
        utm: undefined,
        device: "mobile",
        country: "IN",
      }),
    ];
    const base = Date.now() - 60_000;
    await EventModel.insertMany(
      rows.map((row, index) => ({ ...row, ts: new Date(base + index * 1000) })),
    );
    await rollupDay(projectId, new Date());
    return utcDateKey(new Date());
  }

  it("aggregates pageviews, visitors, paths, referrers, devices, countries, clicks and events", async () => {
    const date = await seedDay();
    const stored = await DailyStatModel.findOne({ projectId, date }).lean();
    const byPath = counts(stored?.byPath);
    const byReferrer = counts(stored?.byReferrer);
    const byCountry = counts(stored?.byCountry);
    const byDevice = counts(stored?.byDevice);
    const byBrowser = counts(stored?.byBrowser);
    const byOs = counts(stored?.byOs);
    const clicksByTarget = counts(stored?.clicksByTarget);
    const byEvent = counts(stored?.byEvent);
    expect(stored?.pageviews).toBe(3);
    expect(stored?.visitors).toBe(3);
    expect(stored?.clicks).toBe(1);
    expect(stored?.customEvents).toBe(1);
    expect(byPath).toEqual({ "/": 2, "/pricing": 1 });
    expect(byReferrer["https://google.com/"]).toBe(2);
    expect(byReferrer["utm:newsletter"]).toBe(1);
    expect(byCountry).toEqual({ CA: 3, DE: 1, IN: 1 });
    expect(byDevice).toEqual({ desktop: 4, mobile: 1 });
    expect(byBrowser).toEqual({ Chrome: 4, Safari: 1 });
    expect(byOs).toEqual({ "Mac OS": 5 });
    expect(clicksByTarget).toEqual({ "[/pricing] Buy now (#buy)": 1 });
    expect(byEvent).toEqual({ signup_clicked: 1 });
    expect(stored?.visitorIds).toHaveLength(3);
  });

  it("caps rollup key length while preserving dots, $ and click selectors", async () => {
    expect(rollupKeySafe("https://google.com/search?q=a.b", 200)).toBe(
      "https://google.com/search?q=a.b",
    );
    expect(rollupKeySafe("/docs/v1.0/intro", 200)).toBe("/docs/v1.0/intro");
    expect(rollupKeySafe("$where", 40)).toBe("where");
    expect(rollupKeySafe("  [/pricing] Buy now (.btn)  ", 200)).toBe(
      "[/pricing] Buy now (.btn)",
    );
    expect(rollupKeySafe("", 40)).toBe("");
    expect(rollupKeySafe("x".repeat(50), 10)).toBe(`${"x".repeat(10)}…`);

    const context = {
      projectId: projectObjectId(),
      keyPrefix: "mak_abc",
      ip: "203.0.113.4",
      country: "GB",
      now: new Date(),
      headerUserAgent: CHROME,
    };
    const hostile = [
      { type: "pageview", path: "/favicon.ico", referrer: "https://a.b.c/d" },
      {
        type: "click",
        path: "/docs/v1.0",
        name: "[/docs/v1.0] Go (.btn .primary)",
        referrer: "",
      },
      { type: "custom", name: "$where=1", path: "/evil" },
    ].map((entry) => {
      const prepared = prepareEvent(entry, context);
      if (!("doc" in prepared)) {
        throw new Error(`expected ${entry.name} to be stored`);
      }
      return prepared.doc;
    });
    await EventModel.insertMany(hostile);
    await rollupDay(projectId, new Date());
    const stored = await DailyStatModel.findOne({
      projectId,
      date: utcDateKey(new Date()),
    }).lean();
    expect(Object.keys(counts(stored?.byPath))).toEqual(["/favicon.ico"]);
    expect(Object.keys(counts(stored?.byReferrer))).toEqual(["https://a.b.c/d"]);
    expect(Object.keys(counts(stored?.clicksByTarget))).toEqual([
      "[/docs/v1.0] Go (.btn .primary)",
    ]);
    expect(Object.keys(counts(stored?.byEvent))).toEqual(["where=1"]);
  });

  it("only keeps a two letter country code from a spoofable header", () => {
    expect(cleanCountry("de")).toBe("DE");
    expect(cleanCountry(" usa ")).toBe("");
    expect(cleanCountry("")).toBe("");
    expect(cleanCountry("de.evil.com")).toBe("");
  });

  it("replaces rather than double counts when the same day is rolled up again", async () => {
    const date = await seedDay();
    await rollupDay(projectId, new Date());
    const stored = await DailyStatModel.findOne({ projectId, date }).lean();
    expect(stored?.pageviews).toBe(3);
    expect(stored?.visitors).toBe(3);
    expect(await DailyStatModel.countDocuments({ projectId, date })).toBe(1);
  });

  it("never aggregates an event flagged as rejected", async () => {
    await EventModel.insertMany([
      eventRow({ visitorId: "v1" }),
      eventRow({ visitorId: "v9", path: "/spam", rejected: true }),
    ]);
    await rollupDay(projectId, new Date());
    const stored = await DailyStatModel.findOne({
      projectId,
      date: utcDateKey(new Date()),
    }).lean();
    expect(stored?.pageviews).toBe(1);
    expect(counts(stored?.byPath)["/spam"]).toBeUndefined();
  });

  it("folds rollup maps into ranked breakdowns and a dense series", async () => {
    const yesterday = utcDateKey(addDays(new Date(), -1));
    const today = utcDateKey(new Date());
    const rollups: DailyRollup[] = [
      {
        date: yesterday,
        pageviews: 4,
        visitors: 2,
        clicks: 1,
        customEvents: 0,
        byPath: { "/": 3, "/blog": 1 },
        byCountry: { CA: 2, DE: 2 },
        byReferrer: { "https://google.com": 3, "utm:news": 1 },
        byDevice: { desktop: 4 },
        byBrowser: { Chrome: 4 },
        byOs: { "Mac OS": 4 },
        clicksByTarget: { "[/] Nav (#nav)": 1 },
        byEvent: {},
      },
      {
        date: today,
        pageviews: 6,
        visitors: 3,
        clicks: 2,
        customEvents: 1,
        byPath: { "/": 5, "/pricing": 1 },
        byCountry: { CA: 4, IN: 2 },
        byReferrer: { "https://google.com": 4, "utm:news": 2 },
        byDevice: { desktop: 4, mobile: 2 },
        byBrowser: { Chrome: 6 },
        byOs: { "Mac OS": 6 },
        clicksByTarget: { "[/] Nav (#nav)": 1, "[/pricing] Buy (#buy)": 1 },
        byEvent: { signup_clicked: 1 },
      },
    ];
    const start = addDays(dailyWindowStart(new Date()), -6);
    const end = addDays(dailyWindowStart(new Date()), 1);
    const series = alignSeries(rollups, start, end);
    expect(series).toHaveLength(7);
    expect(series[0]?.pageviews).toBe(0);
    expect(series[5]?.pageviews).toBe(4);
    expect(series[6]?.date).toBe(today);
    expect(sumSeries(series)).toMatchObject({ pageviews: 10, visitors: 5, clicks: 3, customEvents: 1 });

    const byReferrer = mergeCountMaps(rollups.map((row) => row.byReferrer));
    expect(rankCounts(byReferrer, 5)).toEqual([
      { name: "https://google.com", count: 7 },
      { name: "utm:news", count: 3 },
    ]);
    expect(rankCounts(mergeCountMaps(rollups.map((row) => row.byPath)))).toEqual([
      { name: "/", count: 8 },
      { name: "/blog", count: 1 },
      { name: "/pricing", count: 1 },
    ]);
    expect(rankCounts(mergeCountMaps(rollups.map((row) => row.byCountry)), 1)).toEqual([
      { name: "CA", count: 6 },
    ]);
    expect(rankCounts(mergeCountMaps(rollups.map((row) => row.clicksByTarget)))).toEqual([
      { name: "[/] Nav (#nav)", count: 2 },
      { name: "[/pricing] Buy (#buy)", count: 1 },
    ]);
    expect(combineSeries([series, series])[6]).toMatchObject({ pageviews: 12, visitors: 6 });
  });

  it("builds a summary from rollups with entry pages, campaigns and active now", async () => {
    await seedDay();
    const summary = await analyticsSummary(projectId, { range: "today" });
    expect(summary.totals.pageviews).toBe(3);
    expect(summary.totals.visitors).toBe(3);
    expect(summary.totals.clicks).toBe(1);
    expect(summary.totals.customEvents).toBe(1);
    expect(summary.totals.activeNow).toBe(3);
    expect(summary.topPages[0]).toEqual({ name: "/", count: 2 });
    expect(summary.referrers[0]).toEqual({ name: "https://google.com/", count: 2 });
    expect(summary.sources[0]).toEqual({ name: "newsletter", count: 1 });
    expect(summary.utm[0]).toEqual({
      source: "newsletter",
      medium: "email",
      campaign: "",
      count: 1,
    });
    expect(summary.clicks[0]?.name).toBe("[/pricing] Buy now (#buy)");
    expect(summary.customEvents[0]).toEqual({ name: "signup_clicked", count: 1 });
    expect(summary.countries).toEqual([
      { name: "CA", count: 3 },
      { name: "DE", count: 1 },
      { name: "IN", count: 1 },
    ]);
    expect(summary.entryPages).toEqual([{ name: "/", count: 2 }]);
    expect(summary.days).toBe(1);
    expect(summary.timezone).toBe("UTC");
    expect(summary.activeWindowMinutes).toBe(5);
    expect(summary.series).toHaveLength(1);
  });

  it("refuses an invalid project id instead of returning a silent empty summary", async () => {
    await expect(analyticsSummary("not-an-object-id")).rejects.toThrow(IngestError);
  });
});

describe("payload hardening helpers", () => {
  it("rejects every server derived field in an event entry", () => {
    expect(EVENT_SERVER_DERIVED_FIELDS).toContain("visitorId");
    for (const field of EVENT_SERVER_DERIVED_FIELDS) {
      expect(hasForbiddenEventFields({ type: "pageview", [field]: "x" })).toBe(true);
    }
    expect(hasForbiddenEventFields({ type: "pageview", path: "/" })).toBe(false);
    expect(hasForbiddenEventFields(null)).toBe(true);
    expect(hasForbiddenEventFields("nope")).toBe(true);
  });

  it("rejects stale and future client clocks and oversized props", () => {
    const now = new Date();
    const context = {
      projectId: projectObjectId(),
      keyPrefix: "mak_abc",
      ip: "203.0.113.4",
      country: "",
      now,
      headerUserAgent: CHROME,
    };
    expect(
      prepareEvent({ type: "pageview", ts: now.getTime() - MAX_TS_AGE_MS - 5000 }, context),
    ).toEqual({ error: "stale" });
    expect(
      prepareEvent({ type: "pageview", ts: now.getTime() + MAX_TS_FUTURE_MS + 5000 }, context),
    ).toEqual({ error: "stale" });
    expect(
      prepareEvent({ type: "pageview", ts: now.getTime() - MAX_TS_AGE_MS + 5000 }, context),
    ).not.toEqual({ error: "stale" });
    expect(
      prepareEvent({ type: "pageview", props: { blob: "x".repeat(MAX_META_BYTES + 10) } }, context),
    ).toEqual({ error: "props_too_large" });
    expect(prepareEvent({ type: "pageview", visitorId: "forged" }, context)).toEqual({
      error: "forbidden",
    });
  });

  it("caps path and name length and strips an empty utm object", () => {
    const context = {
      projectId: projectObjectId(),
      keyPrefix: "mak_abc",
      ip: "",
      country: "",
      now: new Date(),
      headerUserAgent: IPHONE,
    };
    const prepared = prepareEvent(
      { type: "click", path: `/${"a".repeat(MAX_PATH_CHARS + 50)}`, name: "n".repeat(400), utm: {} },
      context,
    );
    expect("doc" in prepared).toBe(true);
    if (!("doc" in prepared)) {
      return;
    }
    const value = prepared.doc as unknown as Record<string, unknown>;
    expect(String(value.path)).toHaveLength(MAX_PATH_CHARS + 1);
    expect(String(value.name)).toHaveLength(121);
    expect(value.utm).toBeUndefined();
    expect(value.device).toBe("mobile");
    expect(parseUserAgent(IPHONE).browser).toBe("Mobile Safari");
  });

  it("keeps only the five known utm keys, cleaned", () => {
    expect(cleanUtm(undefined)).toEqual({});
    expect(cleanUtm({ source: " x ", medium: "cpc", evil: "no", term: 12 })).toEqual({
      source: "x",
      medium: "cpc",
    });    expect(UTM_FIELDS).toHaveLength(5);
  });
});

describe("origin soft check", () => {
  it("derives the allowed hosts from the project links", () => {
    expect(
      hostsFromLinks([
        { type: "live", url: "https://shop.test/checkout" },
        { type: "docs", url: "https://docs.shop.test" },
        { type: "other", url: "not a url" },
        { type: "github", url: "https://github.com/x/y" },
      ]),
    ).toEqual(["shop.test", "docs.shop.test"]);
    expect(hostsFromLinks(undefined)).toEqual([]);
  });

  it("is disabled when the project declares no host", () => {
    expect(originCheck(new Headers({ origin: "https://evil.test" }), [])).toBe("disabled");
  });

  it("accepts the site host and its subdomains and rejects a foreign origin", () => {
    expect(originCheck(new Headers({ origin: "https://shop.test" }), ["shop.test"])).toBe("ok");
    expect(originCheck(new Headers({ origin: "https://app.shop.test" }), ["shop.test"])).toBe("ok");
    expect(originCheck(new Headers({ origin: "https://evil.test" }), ["shop.test"])).toBe(
      "cross_site",
    );
    expect(originCheck(new Headers({ origin: "https://notshop.test" }), ["shop.test"])).toBe(
      "cross_site",
    );
  });

  it("treats a sandboxed or absent origin as unattributed rather than hostile", () => {
    expect(originCheck(new Headers({ origin: "null" }), ["shop.test"])).toBe("ok");
    expect(originCheck(new Headers({ referer: "https://news.example/post" }), ["shop.test"])).toBe(
      "ok",
    );
    expect(originCheck(new Headers(), ["shop.test"])).toBe("ok");
  });
});

describe("event csv export", () => {
  it("neutralizes formula injection in every cell", () => {
    const csv = toCsv(
      ["name", "path"],
      [
        { name: "=cmd|'/c calc'!A0", path: "+1-2" },
        { name: "-danger", path: "@SUM(1)" },
      ],
    );
    expect(csv.split("\n")[1]).toContain("'=cmd");
    expect(csv).toContain("'+1-2");
    expect(csv).toContain("'-danger");
    expect(csv).toContain("'@SUM(1)");
    expect(escapeCsvCell("=x")).toBe("'=x");
  });

  it("serializes an event into the exported columns", async () => {
    const created = await EventModel.create(eventRow({ name: "=checkout", path: "/pay" }));
    const serialized = serializeEvent(created.toObject() as never);
    expect(Object.keys(serialized).sort()).toEqual([...EVENT_EXPORT_COLUMNS].sort());
    expect(serialized.type).toBe("pageview");
    expect(serialized.path).toBe("/pay");
    expect(serialized.utm).toEqual({});
    const row: Record<string, unknown> = {};
    for (const column of EVENT_EXPORT_COLUMNS) {
      row[column] =
        column === "utm" || column === "props"
          ? JSON.stringify(serialized[column])
          : serialized[column];
    }
    const csv = toCsv(EVENT_EXPORT_COLUMNS, [row]);
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain("'=checkout");
  });
});

describe("tracker script", () => {
  it("never evaluates anything and defines the public api", () => {
    expect(TRACKER_SOURCE).toContain("window.__mgr = function");
    expect(TRACKER_SOURCE).toContain('"event"');
    expect(TRACKER_SOURCE).not.toMatch(/eval\s*\(/);
    expect(TRACKER_SOURCE).not.toContain("new Function");
    expect(TRACKER_SOURCE).not.toContain("setTimeout(\"");
    expect(TRACKER_SOURCE).not.toContain("document.write");
    expect(TRACKER_SOURCE).not.toContain("innerHTML");
    expect(TRACKER_SOURCE).not.toContain("`");
    expect(TRACKER_SOURCE).not.toContain("${");
  });

  it("reads its config from the script tag and honours the version parameter", () => {
    expect(TRACKER_SOURCE).toContain('getAttribute("data-key")');
    expect(TRACKER_SOURCE).toContain('getAttribute("data-app")');
    expect(TRACKER_SOURCE).toContain('src.split("?v=")[1]');
    expect(TRACKER_SOURCE).toContain(`var VERSION = ${TRACKER_VERSION};`);
    expect(TRACKER_SOURCE).toContain('src.indexOf("/t.js")');
  });

  it("auto tracks pageviews including spa navigation and clicks", () => {
    expect(TRACKER_SOURCE).toContain('patch("pushState")');
    expect(TRACKER_SOURCE).toContain('patch("replaceState")');
    expect(TRACKER_SOURCE).toContain('addEventListener("popstate"');
    expect(TRACKER_SOURCE).toContain('addEventListener("click", onClick, true)');
    expect(TRACKER_SOURCE).toContain('"[" + path() + "] " + text + " (" + selector + ")"');
    expect(TRACKER_SOURCE).toContain("TEXT_LIMIT = 100");
  });

  it("batches with a beacon on unload and keepalive fetch otherwise", () => {
    expect(TRACKER_SOURCE).toContain("navigator.sendBeacon");
    expect(TRACKER_SOURCE).toContain("keepalive: true");
    expect(TRACKER_SOURCE).toContain('addEventListener("pagehide"');
    expect(TRACKER_SOURCE).toContain('"visibilitychange"');
  });

  it("respects a do not track style opt out", () => {
    expect(TRACKER_SOURCE).toContain('navigator.doNotTrack === "1"');
    expect(TRACKER_SOURCE).toContain("navigator.globalPrivacyControl === true");
    expect(TRACKER_SOURCE).toContain('s.getItem(OPT_OUT_STORE) === "1"');
    expect(TRACKER_SOURCE).toContain('if (optedOut()) {\n      return;\n    }');
  });

  it("never lets a key reach a query string and never throws into the host page", () => {
    expect(TRACKER_SOURCE).not.toContain("?key=");
    expect(TRACKER_SOURCE).not.toContain("&key=");
    expect(TRACKER_SOURCE).toContain('JSON.stringify({ key: key, events: batch })');
    expect(TRACKER_SOURCE).toContain('endpoint + "/api/ingest/events"');
    expect(TRACKER_SOURCE).not.toContain("location.search + \"?");
    const catches = TRACKER_SOURCE.match(/catch \(e\)/g) ?? [];
    expect(catches.length).toBeGreaterThanOrEqual(15);
  });

  it("stays inside the size budget", () => {
    expect(gzipSync(Buffer.from(TRACKER_SOURCE, "utf8")).byteLength).toBeLessThan(4096);
  });

  it("renders the exact embed snippet with the key in an attribute", () => {
    const snippet = getEmbedSnippet({
      origin: "https://manager.example.com/",
      slug: "my-site",
      key: "mak_abcdefghijklmnop",
    });
    expect(snippet.html).toBe(
      '<script async src="https://manager.example.com/t.js?v=1" data-app="my-site" data-key="mak_abcdefghijklmnop"></script>',
    );
    expect(snippet.scriptUrl).toBe("https://manager.example.com/t.js?v=1");
    expect(snippet.hasKey).toBe(true);
    expect(snippet.maskedKey).toBe("mak_abc••••••••");
    expect(snippet.maskedHtml).toContain('data-key="mak_abc••••••••"');
    expect(snippet.maskedHtml).not.toContain("mak_abcdefghijklmnop");
    const withoutKey = getEmbedSnippet({ origin: "https://manager.example.com", slug: "my-site" });
    expect(withoutKey.hasKey).toBe(false);
    expect(withoutKey.html).toContain('data-key="mak_••••••••"');
    expect(getEmbedSnippet({ origin: "https://m.test", slug: "s", version: 4 }).html).toContain("?v=4");
    expect(getEmbedSnippet({ origin: "https://m.test", slug: '"><img>' }).html).not.toContain("<img>");
  });
});

describe("series helpers", () => {
  it("treats missing days as zero and keeps the series sorted", () => {
    const points: SeriesPoint[] = [
      { date: "2026-01-03", pageviews: 1, visitors: 1, clicks: 0, customEvents: 0 },
      { date: "2026-01-01", pageviews: 2, visitors: 2, clicks: 0, customEvents: 0 },
    ];
    const series = alignSeries(points, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-04T00:00:00Z"));
    expect(series.map((point) => point.pageviews)).toEqual([2, 0, 1]);
    expect(series.map((point) => point.date)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
  });
});
