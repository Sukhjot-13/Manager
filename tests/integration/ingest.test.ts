import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import type { NextRequest } from "next/server";
import {
  clearDatabase,
  startTestDatabase,
  stopTestDatabase,
} from "@/tests/helpers/mongo";
import { authCookie, requestWithCookie } from "@/tests/helpers/request";
import { seedUser } from "@/tests/helpers/users";
import { POST as ingestLogsPost, OPTIONS as ingestOptions } from "@/app/api/ingest/logs/route";
import { GET as sdkGet } from "@/app/api/sdk/logger/route";
import { GET as keysGet, POST as keysPost } from "@/app/api/projects/[slug]/keys/route";
import { GET as allKeysGet, POST as allKeysPost } from "@/app/api/keys/route";
import {
  DELETE as keyDelete,
  PATCH as keyPatch,
} from "@/app/api/keys/[id]/route";
import { GET as logsGet } from "@/app/api/projects/[slug]/logs/route";
import {
  GET as exportGet,
  POST as exportPost,
} from "@/app/api/projects/[slug]/logs/export/route";
import { LogModel } from "@/lib/db/logs";
import { AppSettingModel, RateLimitModel } from "@/lib/db/ops";
import { ApiKeyModel } from "@/lib/db/apikeys";
import { ProjectModel } from "@/lib/db/projects";
import { hashKey } from "@/lib/apiKeys";
import { generateVerifiableApiKey } from "@/lib/keyManagement";
import { MAX_BODY_BYTES } from "@/lib/validation";
import { resetMemoryBuckets } from "@/lib/ratelimit";
import type { KeyKind } from "@/lib/db/apikeys";

type Cookie = { name: string; value: string };

const ORIGIN = "http://localhost:3000";
const SLUG = "logs-demo";
const OWNER_EMAIL = "owner@example.com";

let ownerCookie: Cookie = { name: "", value: "" };
let projectId = "";
let serverKey = "";
let clientKey = "";
let analyticsKey = "";

function slugContext(slug = SLUG): { params: Promise<{ slug: string }> } {
  return { params: Promise.resolve({ slug }) };
}

function idContext(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function ingestRequest(
  options: {
    key?: string | null;
    body?: unknown;
    rawBody?: string;
    contentType?: string | null;
    ip?: string;
    country?: string;
  } = {},
): NextRequest {
  const headers = new Headers();
  const contentType =
    options.contentType === undefined ? "application/json" : options.contentType;
  if (contentType !== null) {
    headers.set("content-type", contentType);
  }
  if (options.key !== undefined && options.key !== null) {
    headers.set("x-api-key", options.key);
  }
  if (options.ip !== undefined) {
    headers.set("x-forwarded-for", options.ip);
  }
  if (options.country !== undefined) {
    headers.set("x-vercel-ip-country", options.country);
  }
  const body = options.rawBody ?? JSON.stringify(options.body ?? {});
  return requestWithCookie(`${ORIGIN}/api/ingest/logs`, undefined, {
    method: "POST",
    headers,
    body,
  });
}

async function post(options: Parameters<typeof ingestRequest>[0] = {}): Promise<Response> {
  return ingestLogsPost(ingestRequest(options));
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

async function seedLogs(count: number, overrides: Record<string, unknown> = {}): Promise<void> {
  const base = Date.now() - 60_000 * count;
  const rows = Array.from({ length: count }, (_unused, index) => ({
    projectId: new mongoose.Types.ObjectId(projectId),
    keyPrefix: serverKey.slice(0, 7),
    level: "info",
    message: `seeded_${index}`,
    source: "server",
    environment: "prod",
    release: "1.0.0",
    ts: new Date(base + index * 1000),
    receivedAt: new Date(),
    ...overrides,
  }));
  await LogModel.insertMany(rows);
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
    name: "Logs Demo",
    slug: SLUG,
    status: "live",
    ingestEnabled: true,
    analyticsEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  projectId = String(created.insertedId);
  serverKey = await seedKey("server", "api-worker");
  clientKey = await seedKey("client", "browser");
  analyticsKey = await seedKey("analytics", "tracker");
});

describe("ingest authentication", () => {
  it("answers a request with no key at all with a generic 401", async () => {
    const response = await post({ key: null, body: { logs: [{ level: "info", message: "x" }] } });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("answers an unknown key with the same generic 401 and no detail", async () => {
    const unknown = await post({
      key: "mlk_totally-unknown-key-value-0000",
      body: { logs: [{ level: "info", message: "x" }] },
    });
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a revoked key", async () => {
    await ApiKeyModel.updateMany({}, { $set: { revokedAt: new Date() } });
    const response = await post({ key: serverKey, body: { logs: [{ level: "info", message: "x" }] } });
    expect(response.status).toBe(401);
  });

  it("never leaks which part of a key was wrong", async () => {
    const tampered = `${serverKey.slice(0, -4)}zzzz`;
    const response = await post({ key: tampered, body: { logs: [] } });
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).toBe('{"error":"unauthorized"}');
  });

  it("rejects an analytics key on the logs endpoint", async () => {
    const response = await post({
      key: analyticsKey,
      body: { logs: [{ level: "info", message: "tracked" }] },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(await LogModel.countDocuments({})).toBe(0);
  });

  it("allows CORS for the ingest route but never with credentials", async () => {
    const options = await ingestOptions();
    expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-origin")).toBe("*");
    expect(options.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
    expect(options.headers.get("access-control-allow-headers")).toContain("x-api-key");
    // Regression: the browser SDK sends x-trace-id for trace correlation. If the preflight
    // omits it, every browser-side log is dropped by CORS while the SDK reports success.
    const allowed = (options.headers.get("access-control-allow-headers") ?? "").toLowerCase();
    for (const header of ["content-type", "x-api-key", "x-trace-id"]) {
      expect(allowed).toContain(header);
    }
    expect(options.headers.get("access-control-allow-credentials")).toBeNull();
    expect(options.headers.get("access-control-max-age")).toBeTruthy();
    const response = await post({ key: serverKey, body: { logs: [{ level: "info", message: "cors" }] } });
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

describe("ingest content type and size caps", () => {
  it("rejects a non JSON content type with 415", async () => {
    const response = await post({
      key: serverKey,
      contentType: "text/plain",
      rawBody: "level=info",
    });
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "unsupported_media_type" });
  });

  it("rejects an oversized body with 413 before anything is stored", async () => {
    const huge = JSON.stringify({
      logs: [{ level: "info", message: "x".repeat(MAX_BODY_BYTES + 100) }],
    });
    const response = await post({ key: serverKey, rawBody: huge });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
    expect(await LogModel.countDocuments({})).toBe(0);
  });

  it("rejects a body over the configured batch cap", async () => {
    await AppSettingModel.create({ key: "ingest.maxLogBatch", value: 2 });
    const response = await post({
      key: serverKey,
      body: {
        logs: Array.from({ length: 3 }, (_unused, index) => ({
          level: "info",
          message: `m${index}`,
        })),
      },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "batch_too_large" });
  });

  it("rejects a malformed JSON body", async () => {
    const response = await post({ key: serverKey, rawBody: "{not json" });
    expect(response.status).toBe(400);
  });
});

describe("ingest key-kind scoping and server-derived fields", () => {
  it("stamps source, ip, country and key prefix from the key and the connection", async () => {
    const response = await post({
      key: serverKey,
      ip: "203.0.113.9, 10.0.0.1",
      country: "de",
      body: { logs: [{ level: "info", message: "server_row", environment: "prod" }] },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: 1,
      rejected: 0,
      duplicates: 0,
      stored: 1,
      stale: 0,
    });
    const row = await LogModel.findOne({ message: "server_row" }).lean();
    expect(row?.source).toBe("server");
    expect(row?.ip).toBe("203.0.113.9");
    expect(row?.country).toBe("DE");
    expect(row?.keyPrefix).toBe(serverKey.slice(0, 7));
    expect(row?.receivedAt).toBeInstanceOf(Date);
  });

  it("writes client rows for a client key and never lets a client key claim server", async () => {
    const ok = await post({
      key: clientKey,
      body: { logs: [{ level: "info", message: "client_row", url: "https://shop.test/cart" }] },
    });
    expect(ok.status).toBe(200);
    const row = await LogModel.findOne({ message: "client_row" }).lean();
    expect(row?.source).toBe("client");

    const forged = await post({
      key: clientKey,
      body: { logs: [{ level: "info", message: "forged_source", source: "server" }] },
    });
    expect(forged.status).toBe(400);
    expect(await forged.json()).toEqual({ error: "invalid_payload" });
    expect(await LogModel.countDocuments({ message: "forged_source" })).toBe(0);
  });

  it("rejects a server key writing source client", async () => {
    const response = await post({
      key: serverKey,
      body: { logs: [{ level: "info", message: "wrong_side", source: "client" }] },
    });
    expect(response.status).toBe(400);
    expect(await LogModel.countDocuments({ message: "wrong_side" })).toBe(0);
  });

  it("rejects forged ip, country, receivedAt and keyPrefix fields in the payload", async () => {
    for (const field of ["ip", "country", "receivedAt", "keyPrefix", "projectId"]) {
      const response = await post({
        key: serverKey,
        body: {
          logs: [{ level: "info", message: `forged_${field}`, [field]: "1.2.3.4" }],
        },
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_payload" });
    }
    expect(await LogModel.countDocuments({ message: /^forged_/ })).toBe(0);
  });

  it("rejects node runtime fields from a client key but accepts them from a server key", async () => {
    const clientResponse = await post({
      key: clientKey,
      body: { logs: [{ level: "info", message: "browser_pid", pid: 1, hostname: "srv" }] },
    });
    expect(clientResponse.status).toBe(200);
    expect(await clientResponse.json()).toMatchObject({ accepted: 0, rejected: 1 });
    expect(await LogModel.countDocuments({ message: "browser_pid" })).toBe(0);
    const serverResponse = await post({
      key: serverKey,
      body: {
        logs: [
          {
            level: "info",
            message: "node_row",
            pid: 4242,
            hostname: "worker-1",
            runtimeVersion: "v22.0.0",
            rssMb: 128,
            uptimeSec: 900,
          },
        ],
      },
    });
    expect(serverResponse.status).toBe(200);
    const row = await LogModel.findOne({ message: "node_row" }).lean();
    expect(row?.pid).toBe(4242);
    expect(row?.hostname).toBe("worker-1");
  });

  it("rejects a payload entry whose meta exceeds 8KB", async () => {
    const response = await post({
      key: serverKey,
      body: {
        logs: [
          { level: "info", message: "small" },
          { level: "info", message: "huge", meta: { blob: "y".repeat(9000) } },
        ],
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: 1, rejected: 1, stored: 1 });
    expect(await LogModel.countDocuments({ message: "huge" })).toBe(0);
  });
});

describe("ingest replay guard and duplicate collapsing", () => {
  it("rejects stale and forged timestamps and reports them", async () => {
    const now = Date.now();
    const response = await post({
      key: serverKey,
      body: {
        logs: [
          { level: "info", message: "fresh", ts: now },
          { level: "info", message: "ancient", ts: now - 25 * 60 * 60 * 1000 },
          { level: "info", message: "future", ts: now + 20 * 60 * 1000 },
          { level: "info", message: "no_clock" },
        ],
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accepted: 2,
      rejected: 2,
      duplicates: 0,
      stored: 2,
      stale: 2,
    });
    const messages = (await LogModel.find({}).lean()).map((row) => row.message).sort();
    expect(messages).toEqual(["fresh", "no_clock"]);
  });

  it("accepts timestamps just inside both guard boundaries", async () => {
    const now = Date.now();
    const response = await post({
      key: serverKey,
      body: {
        logs: [
          { level: "info", message: "edge_old", ts: now - 24 * 60 * 60 * 1000 + 5000 },
          { level: "info", message: "edge_future", ts: now + 10 * 60 * 1000 - 5000 },
        ],
      },
    });
    expect(await response.json()).toMatchObject({ accepted: 2, rejected: 0, stale: 0 });
    const outside = await post({
      key: serverKey,
      body: {
        logs: [
          { level: "info", message: "just_past_old", ts: now - 24 * 60 * 60 * 1000 - 5000 },
          { level: "info", message: "just_past_future", ts: now + 10 * 60 * 1000 + 5000 },
        ],
      },
    });
    expect(await outside.json()).toMatchObject({ accepted: 0, rejected: 2, stale: 2 });
  });

  it("collapses repeated errors into one counted row inside the window", async () => {
    const first = await post({
      key: serverKey,
      body: {
        logs: [{ level: "error", message: "payment_failed", stack: "Error: x\n  at pay (/a.js:1:1)" }],
      },
    });
    expect(await first.json()).toMatchObject({ stored: 1, duplicates: 0 });
    const second = await post({
      key: serverKey,
      body: {
        logs: [
          { level: "error", message: "payment_failed", stack: "Error: x\n  at pay (/a.js:1:1)" },
          { level: "error", message: "payment_failed", stack: "Error: x\n  at pay (/a.js:1:1)" },
        ],
      },
    });
    expect(await second.json()).toMatchObject({ accepted: 2, stored: 0, duplicates: 2 });
    const rows = await LogModel.find({ level: "error" }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.count).toBe(3);
    expect(rows[0]?.fingerprint).toHaveLength(16);
  });

  it("collapses a batch of distinct errors in a constant number of queries", async () => {
    const findSpy = vi.spyOn(LogModel, "find");
    const findOneAndUpdateSpy = vi.spyOn(LogModel, "findOneAndUpdate");
    const bulkWriteSpy = vi.spyOn(LogModel, "bulkWrite");
    const insertManySpy = vi.spyOn(LogModel, "insertMany");
    const createSpy = vi.spyOn(LogModel, "create");

    const response = await post({
      key: serverKey,
      body: {
        logs: Array.from({ length: 60 }, (_, index) => ({
          level: "error",
          message: `bulk_probe_${index}`,
          stack: `Error: probe ${index}\n    at probe${index}.js:1:1`,
        })),
      },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ stored: 60 });

    // The whole batch costs one lookup, one bulk write and one insert: not 120 round trips.
    expect(findSpy.mock.calls.length).toBeLessThanOrEqual(1);
    expect(bulkWriteSpy.mock.calls.length).toBeLessThanOrEqual(1);
    expect(insertManySpy.mock.calls.length).toBeLessThanOrEqual(1);
    expect(createSpy).not.toHaveBeenCalled();
    expect(findOneAndUpdateSpy).not.toHaveBeenCalled();

    // And a second identical batch only updates counts.
    bulkWriteSpy.mockClear();
    insertManySpy.mockClear();
    const second = await post({
      key: serverKey,
      body: {
        logs: Array.from({ length: 60 }, (_, index) => ({
          level: "error",
          message: `bulk_probe_${index}`,
          stack: `Error: probe ${index}\n    at probe${index}.js:1:1`,
        })),
      },
    });
    expect(await second.json()).toMatchObject({ stored: 0, duplicates: 60 });
    expect(bulkWriteSpy).toHaveBeenCalledTimes(1);
    expect(insertManySpy).not.toHaveBeenCalled();

    findSpy.mockRestore();
    findOneAndUpdateSpy.mockRestore();
    bulkWriteSpy.mockRestore();
    insertManySpy.mockRestore();
    createSpy.mockRestore();
  });

  it("keeps the indexes the viewer and facet panel rely on", async () => {
    await LogModel.syncIndexes();
    const entries = LogModel.schema.indexes() as [
      Record<string, number>,
      { expireAfterSeconds?: number },
    ][];
    const scoped = entries.filter(([, options]) => options.expireAfterSeconds === undefined);
    const ttl = entries.find(([, options]) => options.expireAfterSeconds !== undefined);

    // Every query index is project-scoped so a filter never scans another project's rows.
    expect(scoped.every(([spec]) => Object.keys(spec)[0] === "projectId")).toBe(true);
    expect(scoped.some(([spec]) => spec.level !== undefined)).toBe(true);
    expect(
      scoped.some(([spec]) => spec.environment !== undefined && spec.release !== undefined),
    ).toBe(true);
    expect(scoped.some(([spec]) => spec.fingerprint !== undefined)).toBe(true);
    expect(scoped.some(([spec]) => spec.ts !== undefined && spec._id !== undefined)).toBe(true);
    expect(ttl?.[1]).toMatchObject({ expireAfterSeconds: 60 * 60 * 24 * 30 });
  });

  it("caches counts briefly so live-tail polling does not rescan the collection", async () => {
    const { countLogs, resetLogCountCache } = await import("@/lib/ingest");
    resetLogCountCache();
    await post({
      key: serverKey,
      body: { logs: [{ level: "info", message: `count_probe_${Date.now()}` }] },
    });
    const first = await countLogs(projectId, {});
    expect(first).toBeGreaterThan(0);
    const spy = vi.spyOn(LogModel, "countDocuments");
    expect(await countLogs(projectId, {})).toBe(first);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    resetLogCountCache();
  });

  it("never stores a server-set field even when the schema would allow the key", async () => {
    await post({ key: serverKey, body: { logs: [{ level: "info", message: "clean_row" }] } });
    const row = await LogModel.findOne({ message: "clean_row" }).lean();
    expect(row).not.toHaveProperty("keyPrefix", "");
    expect(row?.count).toBe(1);
  });
});

describe("ingest kill switches and rate limiting", () => {
  it("rejects ingest when the global kill switch is off", async () => {
    await AppSettingModel.create({ key: "ingest.enabled", value: false });
    const response = await post({ key: serverKey, body: { logs: [{ level: "info", message: "blocked" }] } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "ingest_disabled" });
    expect(await LogModel.countDocuments({})).toBe(0);
  });

  it("rejects ingest when the project kill switch is off", async () => {
    await ProjectModel.updateOne({ slug: SLUG }, { $set: { ingestEnabled: false } });
    const response = await post({ key: serverKey, body: { logs: [{ level: "info", message: "blocked" }] } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "ingest_disabled" });
  });

  it("returns 429 with Retry-After once the durable per key counter is spent", async () => {
    const keyRow = await ApiKeyModel.findOne({ prefix: serverKey.slice(0, 7) }).lean();
    const keyId = String(keyRow?._id);
    const windowStart = new Date(
      Math.floor(Date.now() / 60000) * 60000,
    );
    await RateLimitModel.create({
      key: `ingest:logs:req:${keyId}`,
      windowStart,
      count: 500,
    });
    const response = await post({
      key: serverKey,
      body: { logs: [{ level: "info", message: "over_quota" }] },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const retryAfter = Number(response.headers.get("retry-after") ?? "0");
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(await response.json()).toMatchObject({ error: "rate_limited" });
    expect(await LogModel.countDocuments({ message: "over_quota" })).toBe(0);

    const allowed = await post({
      key: clientKey,
      body: { logs: [{ level: "info", message: "other_key_unaffected" }] },
    });
    expect(allowed.status).toBe(200);
  });
});

describe("log viewer authorization and pagination", () => {
  it("requires a session", async () => {
    await seedLogs(3);
    const response = await logsGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/logs`, undefined),
      slugContext(),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("lets the lowest role view logs but refuses a disabled account", async () => {
    await seedUser({ email: "reader@example.com", role: "USER" });
    const reader = await authCookie({ email: "reader@example.com", role: "USER" });
    const allowed = await logsGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/logs`, reader),
      slugContext(),
    );
    expect(allowed.status).toBe(200);

    await seedUser({ email: "gone@example.com", role: "ADMIN", disabled: true });
    const disabled = await authCookie({ email: "gone@example.com", role: "ADMIN" });
    const refused = await logsGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/logs`, disabled),
      slugContext(),
    );
    expect(refused.status).toBe(401);
  });

  it("returns 403 when logs.view is denied by an override", async () => {
    await seedUser({
      email: "dev@example.com",
      role: "DEVELOPER",
      overrides: { "logs.view": "deny" },
    });
    const dev = await authCookie({ email: "dev@example.com", role: "DEVELOPER" });
    const response = await logsGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/logs`, dev),
      slugContext(),
    );
    expect(response.status).toBe(403);
  });

  it("returns 404 for an unknown project", async () => {
    const response = await logsGet(
      requestWithCookie(`${ORIGIN}/api/projects/nope/logs`, ownerCookie),
      slugContext("nope"),
    );
    expect(response.status).toBe(404);
  });

  it("pages with a keyset cursor and never repeats a row", async () => {
    await seedLogs(120);
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    let total = 0;
    do {
      const query: string = `?limit=50${cursor === null ? "" : `&cursor=${cursor}`}`;
      const response = await logsGet(
        requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/logs${query}`, ownerCookie),
        slugContext(),
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        logs: { id: string }[];
        nextCursor: string | null;
        hasMore: boolean;
        total: number;
      };
      total = payload.total;
      for (const row of payload.logs) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      cursor = payload.hasMore ? payload.nextCursor : null;
      pages += 1;
    } while (cursor !== null && pages < 10);
    expect(pages).toBe(3);
    expect(seen.size).toBe(120);
    expect(total).toBe(120);
  });

  it("filters by level, source, environment, release, session and trace", async () => {
    await LogModel.deleteMany({});
    await seedLogs(1, { level: "error", source: "client", message: "boom", sessionId: "s1", traceId: "t1" });
    await seedLogs(1, { level: "info", source: "server", message: "fine", sessionId: "s2", release: "2.0.0" });
    const query = "levels=error&source=client&environment=prod&release=1.0.0&sessionId=s1&traceId=t1";
    const response = await logsGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/logs?${query}`, ownerCookie),
      slugContext(),
    );
    const payload = (await response.json()) as { logs: { message: string }[]; total: number };
    expect(payload.logs.map((row) => row.message)).toEqual(["boom"]);
    expect(payload.total).toBe(1);
  });

  it("escapes a regex injection attempt in the search box", async () => {
    await LogModel.deleteMany({});
    await seedLogs(1, { message: "normal message" });
    const injection = encodeURIComponent("(a+)+$ .*");
    const response = await logsGet(
      requestWithCookie(
        `${ORIGIN}/api/projects/${SLUG}/logs?search=${injection}`,
        ownerCookie,
      ),
      slugContext(),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { logs: unknown[]; total: number };
    expect(payload.total).toBe(0);
    expect(payload.logs).toEqual([]);
  });

  it("groups errors by fingerprint with counts and a first and last seen", async () => {
    await LogModel.deleteMany({});
    await post({ key: serverKey, body: { logs: [{ level: "error", message: "boom", stack: "at a" }] } });
    await post({ key: serverKey, body: { logs: [{ level: "error", message: "boom", stack: "at a" }] } });
    const response = await logsGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/logs?group=1`, ownerCookie),
      slugContext(),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      groups: { fingerprint: string; count: number; firstSeen: string; lastSeen: string; sample: { message: string } }[];
    };
    expect(payload.groups).toHaveLength(1);
    expect(payload.groups[0]?.count).toBe(2);
    expect(payload.groups[0]?.sample.message).toBe("boom");
    expect(payload.groups[0]?.firstSeen).not.toBe("");
  });

  it("rejects an invalid filter and a malformed cursor", async () => {
    const badLimit = await logsGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/logs?limit=9999`, ownerCookie),
      slugContext(),
    );
    expect(badLimit.status).toBe(400);
    const badCursor = await logsGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/logs?cursor=zzzz`, ownerCookie),
      slugContext(),
    );
    expect(badCursor.status).toBe(400);
  });
});

describe("log export", () => {
  beforeEach(async () => {
    await LogModel.deleteMany({});
    await seedLogs(3, { message: "=cmd|calc" });
  });

  it("requires logs.export and is never cached", async () => {
    await seedUser({ email: "dev@example.com", role: "DEVELOPER" });
    const dev = await authCookie({ email: "dev@example.com", role: "DEVELOPER" });
    const denied = await exportGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/logs/export?format=csv`, dev),
      slugContext(),
    );
    expect(denied.status).toBe(403);

    const allowed = await exportGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/logs/export?format=csv`, ownerCookie),
      slugContext(),
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("cache-control")).toBe("no-store");
    expect(allowed.headers.get("content-type")).toContain("text/csv");
    expect(allowed.headers.get("content-disposition")).toContain("attachment;");
    expect(allowed.headers.get("x-row-count")).toBe("3");
  });

  it("requires a session", async () => {
    const response = await exportGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/logs/export`, undefined),
      slugContext(),
    );
    expect(response.status).toBe(401);
  });

  it("neutralizes formula injection in exported cells", async () => {
    const response = await exportGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/logs/export`, ownerCookie),
      slugContext(),
    );
    const body = await response.text();
    expect(body).toContain("'=cmd|calc");
  });

  it("exports well past the viewer page size and caps at 10k rows", async () => {
    await LogModel.deleteMany({});
    await seedLogs(300);
    const response = await exportGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/logs/export`, ownerCookie),
      slugContext(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-row-count")).toBe("300");
    expect(response.headers.get("x-row-cap")).toBe("10000");
    const body = await response.text();
    expect(body.split("\n").length).toBe(301);
  });

  it("returns JSON through POST with the same filters", async () => {
    const response = await exportPost(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/logs/export`, ownerCookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "json", levels: ["info"], source: "server" }),
      }),
      slugContext(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const payload = (await response.json()) as { project: string; logs: unknown[] };
    expect(payload.project).toBe(SLUG);
    expect(payload.logs).toHaveLength(3);
  });

  it("rejects a malformed export body", async () => {
    const response = await exportPost(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/logs/export`, ownerCookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{oops",
      }),
      slugContext(),
    );
    expect(response.status).toBe(400);
  });
});

describe("cross-project key creation", () => {
  // No default parameter: passing `undefined` must mean "no cookie", so a default here
  // would silently authenticate the unauthenticated case.
  function createRequest(body: unknown, cookie?: { name: string; value: string }): NextRequest {
    return requestWithCookie(`${ORIGIN}/api/keys`, cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("rejects an unauthenticated caller", async () => {
    const response = await allKeysPost(
      createRequest({ projectId, name: "nope", kind: "server" }, undefined),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a caller without keys.manage", async () => {
    await seedUser({ email: "keys-reader@example.com", role: "USER" });
    const reader = await authCookie({ email: "keys-reader@example.com", role: "USER" });
    const response = await allKeysPost(
      createRequest({ projectId, name: "nope", kind: "server" }, reader),
    );
    expect(response.status).toBe(403);
  });

  it("requires an explicit project, so a key is never filed under a guess", async () => {
    const missing = await allKeysPost(
      createRequest({ name: "no project", kind: "server" }, ownerCookie),
    );
    expect(missing.status).toBe(400);
    const blank = await allKeysPost(
      createRequest({ projectId: "   ", name: "blank project", kind: "server" }, ownerCookie),
    );
    expect(blank.status).toBe(400);
    // Nothing was created by either attempt.
    const listed = await allKeysGet(requestWithCookie(`${ORIGIN}/api/keys`, ownerCookie));
    const payload = (await listed.json()) as { keys: { name: string }[] };
    expect(payload.keys.some((row) => row.name.startsWith("no ") || row.name === "blank project")).toBe(
      false,
    );
  });

  it("rejects an unknown project id instead of creating an orphan key", async () => {
    const response = await allKeysPost(
      createRequest(
        { projectId: new mongoose.Types.ObjectId().toString(), name: "ghost", kind: "server" },
        ownerCookie,
      ),
    );
    expect(response.status).toBe(404);
  });

  it("rejects a malformed body and a bad kind", async () => {
    expect((await allKeysPost(createRequest("{", ownerCookie))).status).toBe(400);
    expect(
      (await allKeysPost(createRequest({ projectId, name: "", kind: "server" }, ownerCookie))).status,
    ).toBe(400);
    expect(
      (await allKeysPost(createRequest({ projectId, name: "ok", kind: "root" }, ownerCookie))).status,
    ).toBe(400);
  });
});

describe("api key management", () => {
  it("lists masked keys only", async () => {
    const response = await keysGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/keys`, ownerCookie),
      slugContext(),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(serverKey);
    expect(text).not.toContain(hashKey(serverKey));
    const payload = JSON.parse(text) as { keys: { prefix: string; kind: string; masked: string }[] };
    expect(payload.keys).toHaveLength(3);
    for (const row of payload.keys) {
      expect(row.masked).toContain("••");
      expect(row.masked).not.toContain("*");
      expect(row.masked.startsWith(row.prefix)).toBe(true);
      expect(row.masked.length).toBe(row.prefix.length + 8);
    }
  });

  it("requires keys.view to list and keys.manage to create", async () => {
    await seedUser({ email: "dev@example.com", role: "DEVELOPER" });
    const dev = await authCookie({ email: "dev@example.com", role: "DEVELOPER" });
    const list = await keysGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/keys`, dev),
      slugContext(),
    );
    expect(list.status).toBe(200);
    const create = await keysPost(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/keys`, dev, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "nope", kind: "server" }),
      }),
      slugContext(),
    );
    expect(create.status).toBe(403);
  });

  it("returns the full key exactly once and never lists it again", async () => {
    const created = await keysPost(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/keys`, ownerCookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "worker-2", kind: "server" }),
      }),
      slugContext(),
    );
    expect(created.status).toBe(201);
    const payload = (await created.json()) as {
      key: { id: string; key: string; prefix: string; masked: string };
    };
    expect(payload.key.key.startsWith("mlk_")).toBe(true);
    expect(payload.key.key.length).toBeGreaterThan(20);

    const listed = await keysGet(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/keys`, ownerCookie),
      slugContext(),
    );
    expect(await listed.text()).not.toContain(payload.key.key);

    const ingested = await post({
      key: payload.key.key,
      body: { logs: [{ level: "info", message: "from_new_key" }] },
    });
    expect(ingested.status).toBe(200);
  });

  it("validates the create body", async () => {
    const response = await keysPost(
      requestWithCookie(`${ORIGIN}/api/projects/${SLUG}/keys`, ownerCookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "", kind: "root" }),
      }),
      slugContext(),
    );
    expect(response.status).toBe(400);
  });

  it("revokes a key so that ingest stops immediately", async () => {
    const before = await post({
      key: clientKey,
      body: { logs: [{ level: "info", message: "before_revoke" }] },
    });
    expect(before.status).toBe(200);
    const row = await ApiKeyModel.findOne({ prefix: clientKey.slice(0, 7) }).lean();
    const id = String(row?._id);
    const revoked = await keyPatch(
      requestWithCookie(`${ORIGIN}/api/keys/${id}`, ownerCookie, { method: "PATCH" }),
      idContext(id),
    );
    expect(revoked.status).toBe(200);
    const after = await post({
      key: clientKey,
      body: { logs: [{ level: "info", message: "after_revoke" }] },
    });
    expect(after.status).toBe(401);
  });

  it("deletes a key and 404s for an unknown id", async () => {
    const row = await ApiKeyModel.findOne({ prefix: serverKey.slice(0, 7) }).lean();
    const id = String(row?._id);
    const deleted = await keyDelete(
      requestWithCookie(`${ORIGIN}/api/keys/${id}`, ownerCookie, { method: "DELETE" }),
      idContext(id),
    );
    expect(deleted.status).toBe(200);
    expect(await ApiKeyModel.countDocuments({ _id: new mongoose.Types.ObjectId(id) })).toBe(0);
    const missing = new mongoose.Types.ObjectId().toString();
    const notFound = await keyDelete(
      requestWithCookie(`${ORIGIN}/api/keys/${missing}`, ownerCookie, { method: "DELETE" }),
      idContext(missing),
    );
    expect(notFound.status).toBe(404);
  });

  it("requires keys.manage to revoke", async () => {
    await seedUser({ email: "dev@example.com", role: "DEVELOPER" });
    const dev = await authCookie({ email: "dev@example.com", role: "DEVELOPER" });
    const row = await ApiKeyModel.findOne({ prefix: clientKey.slice(0, 7) }).lean();
    const id = String(row?._id);
    const response = await keyPatch(
      requestWithCookie(`${ORIGIN}/api/keys/${id}`, dev, { method: "PATCH" }),
      idContext(id),
    );
    expect(response.status).toBe(403);
  });

  it("lists every key across projects for keys.view", async () => {
    // Regression: /settings/keys posts here, and the route used to export only GET, so
    // issuing a key from the cross-project screen returned 405 with no local error at all.
    const issued = await allKeysPost(
      requestWithCookie(`${ORIGIN}/api/keys`, ownerCookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, name: "cross-project", kind: "client" }),
      }),
    );
    expect(issued.status).toBe(201);
    const issuedPayload = (await issued.json()) as {
      key: { projectId: string; projectSlug: string; kind: string; key: string; masked: string };
    };
    // The key is bound to the project named in the body, not to some default.
    expect(issuedPayload.key.projectId).toBe(projectId);
    expect(issuedPayload.key.projectSlug).toBe(SLUG);
    expect(issuedPayload.key.kind).toBe("client");
    expect(issuedPayload.key.key).toMatch(/^mck_/);
    // The full value is returned exactly once, and the listing never echoes it.
    const after = await allKeysGet(requestWithCookie(`${ORIGIN}/api/keys`, ownerCookie));
    const afterText = await after.text();
    expect(afterText).not.toContain(issuedPayload.key.key);
    expect(afterText).toContain(issuedPayload.key.masked);

    const response = await allKeysGet(
      requestWithCookie(`${ORIGIN}/api/keys`, ownerCookie),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { keys: { projectSlug: string }[] };
    expect(payload.keys).toHaveLength(4);
    expect(payload.keys.every((row) => row.projectSlug === SLUG)).toBe(true);
    const unauth = await allKeysGet(requestWithCookie(`${ORIGIN}/api/keys`, undefined));
    expect(unauth.status).toBe(401);
  });
});

describe("sdk download route", () => {
  function sdkRequest(key: string | null, query = ""): NextRequest {
    const headers = new Headers();
    if (key !== null) {
      headers.set("x-manager-key", key);
    }
    return requestWithCookie(`${ORIGIN}/api/sdk/logger${query}`, undefined, { headers });
  }

  it("allows the trace header for event ingest too, and never a wildcard on the SDK route", async () => {
    const { OPTIONS: eventOptions } = await import("@/app/api/ingest/events/route");
    const options = await eventOptions();
    expect((options.headers.get("access-control-allow-headers") ?? "").toLowerCase()).toContain(
      "content-type",
    );
    expect(options.headers.get("access-control-allow-origin")).toBe("*");
    expect(options.headers.get("access-control-allow-credentials")).toBeNull();

    const sdk = await sdkGet(sdkRequest(null));
    expect(sdk.status).toBe(401);
    expect(sdk.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("serves the vendored single file sdk for a valid key header", async () => {
    const response = await sdkGet(sdkRequest(serverKey));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    const body = await response.text();
    expect(body).toContain("function initLogger(");
    expect(body).not.toMatch(/^\s*import\s/m);
  });

  it("never authenticates from a query parameter", async () => {
    const response = await sdkGet(sdkRequest(null, `?key=${serverKey}&x-manager-key=${serverKey}`));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects an unknown key and an analytics key", async () => {
    const unknown = await sdkGet(sdkRequest("mlk_nope_nope_nope_nope"));
    expect(unknown.status).toBe(401);
    const analytics = await sdkGet(sdkRequest(analyticsKey));
    expect(analytics.status).toBe(401);
  });

  it("rejects a revoked key", async () => {
    await ApiKeyModel.updateMany({}, { $set: { revokedAt: new Date() } });
    const response = await sdkGet(sdkRequest(serverKey));
    expect(response.status).toBe(401);
  });
});
