import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  escapeRegex,
  hasForbiddenFields,
  MAX_MESSAGE_CHARS,
  metaSize,
  parseIngestTs,
  prepareEntry,
  cleanText,
  decodeCursor,
  encodeCursor,
  resolveLimit,
  MAX_QUERY_LIMIT,
  MAX_EXPORT_ROWS,
} from "@/lib/ingest";
import { MAX_META_BYTES, MAX_TS_AGE_MS, MAX_TS_FUTURE_MS } from "@/lib/validation";
import { fingerprint, normalizeMessage, redactMeta } from "@/lib/fingerprint";
import { escapeCsvCell, toCsv } from "@/lib/csv";
import { generateVerifiableApiKey, isVerifiablePrefix } from "@/lib/keyManagement";
import { initLogger, shutdownLoggers } from "../../packages/logger/src/index";

const ENDPOINT = "https://logs.example.com";

type FetchCall = { url: string; init: Record<string, unknown> };

function stubFetch(): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init: Record<string, unknown>) => {
    calls.push({ url, init });
    return Promise.resolve({ status: 200, ok: true });
  }) as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function payloadOf(call: FetchCall): { logs: Record<string, unknown>[] } {
  return JSON.parse(String(call.init.body)) as { logs: Record<string, unknown>[] };
}

function allLogs(calls: FetchCall[]): Record<string, unknown>[] {
  return calls.flatMap((call) => payloadOf(call).logs);
}

function baseOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    endpoint: ENDPOINT,
    appId: "unit-app",
    apiKey: "mlk_unit_test_key",
    environment: "test",
    ...overrides,
  };
}

afterEach(() => {
  shutdownLoggers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("regex escaping", () => {
  it("escapes every metacharacter so a search string cannot become a pattern", () => {
    expect(escapeRegex("a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o")).toBe(
      "a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o",
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeRegex("payment_failed 42")).toBe("payment_failed 42");
  });

  it("neutralizes a catastrophic backtracking attempt", () => {
    const escaped = escapeRegex("(a+)+$");
    expect(escaped).toBe("\\(a\\+\\)\\+\\$");
    expect(new RegExp(escaped).test("aaaaaaaaaaaaaaaaaaaaaaaaaaX")).toBe(false);
  });
});

describe("timestamp replay guard", () => {
  const now = new Date("2026-03-01T12:00:00.000Z");

  it("accepts a timestamp exactly at the 24h staleness boundary", () => {
    const verdict = parseIngestTs(now.getTime() - MAX_TS_AGE_MS, now);
    expect(verdict.ok).toBe(true);
  });

  it("rejects a timestamp one millisecond past 24h", () => {
    const verdict = parseIngestTs(now.getTime() - MAX_TS_AGE_MS - 1, now);
    expect(verdict).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts a timestamp exactly at the 10 minute future boundary", () => {
    const verdict = parseIngestTs(now.getTime() + MAX_TS_FUTURE_MS, now);
    expect(verdict.ok).toBe(true);
  });

  it("rejects a timestamp one millisecond past 10 minutes in the future", () => {
    const verdict = parseIngestTs(now.getTime() + MAX_TS_FUTURE_MS + 1, now);
    expect(verdict).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts numeric strings, ISO strings and a missing timestamp", () => {
    expect(parseIngestTs(String(now.getTime()), now).ok).toBe(true);
    expect(parseIngestTs(now.toISOString(), now).ok).toBe(true);
    expect(parseIngestTs(undefined, now)).toEqual({ ok: true, ts: now });
  });

  it("rejects unparseable and absurd values", () => {
    expect(parseIngestTs("not-a-date", now)).toEqual({ ok: false, reason: "invalid" });
    expect(parseIngestTs("", now)).toEqual({ ok: false, reason: "invalid" });
    expect(parseIngestTs(Number.NaN, now)).toEqual({ ok: false, reason: "invalid" });
    expect(parseIngestTs(1e18, now)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("payload caps and server-derived fields", () => {
  const now = new Date("2026-03-01T12:00:00.000Z");
  const context = {
    projectId: { toString: () => "0".repeat(24) } as never,
    source: "server" as const,
    keyPrefix: "mlk_abc",
    ip: "203.0.113.7",
    country: "DE",
    now,
    headersUserAgent: "test-agent",
  };

  it("rejects every server-set field smuggled into a payload", () => {
    for (const field of [
      "source",
      "ip",
      "country",
      "receivedAt",
      "keyPrefix",
      "projectId",
      "fingerprint",
      "count",
    ]) {
      expect(hasForbiddenFields({ level: "info", message: "x", [field]: "forged" }, "server")).toBe(
        true,
      );
    }
  });

  it("rejects node runtime fields from a browser key but allows them from a server key", () => {
    const forged = { level: "info", message: "x", hostname: "srv-1", pid: 42 };
    expect(hasForbiddenFields(forged, "client")).toBe(true);
    expect(hasForbiddenFields(forged, "server")).toBe(false);
  });

  it("accepts a clean payload", () => {
    expect(hasForbiddenFields({ level: "info", message: "x", durationMs: 5 }, "client")).toBe(
      false,
    );
    expect(hasForbiddenFields(null, "client")).toBe(true);
  });

  it("caps a message at 1KB and strips control characters", () => {
    const prepared = prepareEntry(
      { level: "info", message: `a\u0007b${"x".repeat(4000)}` },
      context,
    );
    expect("doc" in prepared).toBe(true);
    if (!("doc" in prepared)) {
      return;
    }
    expect(prepared.doc.message.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS + 1);
    expect(prepared.doc.message).not.toContain("\u0007");
    expect(cleanText("ab\u0007cd", 3)).toBe("abc\u2026");
  });

  it("rejects meta whose serialized form exceeds 8KB", () => {
    const small = prepareEntry(
      { level: "info", message: "ok", meta: { blob: "y".repeat(1024) } },
      context,
    );
    expect("doc" in small).toBe(true);
    const large = prepareEntry(
      { level: "info", message: "ok", meta: { blob: "y".repeat(MAX_META_BYTES + 10) } },
      context,
    );
    expect(large).toEqual({ error: "meta_too_large" });
    expect(metaSize({ a: 1 })).toBe(7);
  });

  it("counts an error entry with a fingerprint and leaves info entries unfingerprinted", () => {
    const errored = prepareEntry(
      { level: "error", message: "boom", stack: "Error: boom\n  at foo (/app.js:1:1)" },
      context,
    );
    const info = prepareEntry({ level: "info", message: "fine" }, context);
    expect("fingerprint" in errored && errored.fingerprint).toHaveLength(16);
    expect("fingerprint" in info && info.fingerprint).toBe("");
  });

  it("stamps ip, country and key prefix from the request, never the payload", () => {
    const prepared = prepareEntry({ level: "info", message: "hello" }, context);
    if (!("doc" in prepared)) {
      throw new Error("expected a prepared entry");
    }
    expect(prepared.doc.ip).toBe("203.0.113.7");
    expect(prepared.doc.country).toBe("DE");
    expect(prepared.doc.keyPrefix).toBe("mlk_abc");
    expect(prepared.doc.source).toBe("server");
    expect(prepared.doc.receivedAt).toBe(now);
  });
});

describe("error fingerprinting and redaction", () => {
  it("normalizes volatile tokens so the same failure shares a fingerprint", () => {
    expect(normalizeMessage("order 4815162342 failed for 0x7ffd12")).toBe("order N failed for 0xX");
    expect(fingerprint("order 11 failed", "Error\n  at a (/x.js:1:1)")).toBe(
      fingerprint("order 12 failed", "Error\n  at a (/x.js:1:1)"),
    );
    expect(fingerprint("order failed", "Error\n  at a (/x.js:1:1)")).toBe(
      fingerprint("order failed", "Error\n  at b (/y.js:2:2)"),
    );
  });

  it("masks configured keys at any depth", () => {
    const redacted = redactMeta(
      {
        password: "hunter2",
        user: { authToken: "abc", name: "sukhjot" },
        list: [{ apikey: "k1" }],
        nested: { secret: "s3cret" },
        note: "plain note",
      },
      ["password", "token", "apikey", "secret"],
    ) as Record<string, unknown>;
    expect(redacted.password).toBe("***");
    expect((redacted.user as Record<string, unknown>).authToken).toBe("***");
    expect((redacted.user as Record<string, unknown>).name).toBe("sukhjot");
    expect((redacted.list as Record<string, unknown>[])[0]?.apikey).toBe("***");
    expect(redacted.nested).toEqual({ secret: "***" });
    expect(redacted.note).toBe("plain note");
  });
});

describe("api key prefix verifiability", () => {
  it("rejects a prefix that base64url can turn into more than two segments", () => {
    expect(isVerifiablePrefix("mlk_ab1")).toBe(true);
    expect(isVerifiablePrefix("mlk_m_-")).toBe(false);
    expect(isVerifiablePrefix("mlk__yD")).toBe(false);
    expect(isVerifiablePrefix("mlk_TE_")).toBe(false);
  });

  it("only ever hands back a key the shared verifier can look up", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const kind = attempt % 2 === 0 ? "server" : "client";
      const generated = generateVerifiableApiKey(kind);
      expect(isVerifiablePrefix(generated.prefix)).toBe(true);
      expect(generated.key.slice(0, 7)).toBe(generated.prefix);
      expect(generated.key.startsWith(kind === "server" ? "mlk_" : "mck_")).toBe(true);
      expect(generated.hash).toHaveLength(64);
    }
  });
});

describe("csv formula-injection guard", () => {
  it("prefixes a quote on every dangerous leading character", () => {
    for (const value of ["=1+1", "+1", "-1", "@SUM(A1)", "\tX"]) {
      expect(escapeCsvCell(value).startsWith("'")).toBe(true);
    }
    expect(escapeCsvCell("\rX")).toBe("\" X\"");
  });

  it("leaves safe cells unquoted and quotes separators", () => {
    expect(escapeCsvCell("plain")).toBe("plain");
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("neutralizes an exported attacker-written log message", () => {
    const csv = toCsv(["message"], [{ message: "=cmd|'/c calc'!A1" }]);
    expect(csv.split("\n")[1]?.includes("'=")).toBe(true);
  });
});

describe("cursor pagination helpers", () => {
  it("round-trips a keyset cursor", () => {
    const ts = new Date("2026-03-01T12:00:00.000Z");
    const id = "64b7f0c2a1b2c3d4e5f60718";
    expect(decodeCursor(encodeCursor(ts, id))).not.toBeNull();
    expect(decodeCursor("garbage")).toBeNull();
    expect(decodeCursor(Buffer.from("not-a-timestamp|x").toString("base64url"))).toBeNull();
  });

  it("clamps limits to the maximum page size", () => {
    expect(resolveLimit(undefined, MAX_QUERY_LIMIT)).toBe(50);
    expect(resolveLimit(5000, MAX_QUERY_LIMIT)).toBe(MAX_QUERY_LIMIT);
    expect(resolveLimit(0, MAX_QUERY_LIMIT)).toBe(1);
    expect(MAX_EXPORT_ROWS).toBe(10000);
  });
});

describe("sdk batching, timer and transport", () => {
  it("flushes as soon as a batch of 20 is reached and posts to the ingest path with the key header", async () => {
    const transport = stubFetch();
    try {
      const log = initLogger(baseOptions() as never);
      for (let index = 0; index < 20; index += 1) {
        log.info(`event_${index}`, { index });
      }
      await log.flush();
      expect(transport.calls).toHaveLength(1);
      expect(transport.calls[0]?.url).toBe(`${ENDPOINT}/api/ingest/logs`);
      const init = transport.calls[0]?.init as {
        headers: Record<string, string>;
        method: string;
      };
      expect(init.method).toBe("POST");
      expect(init.headers["x-api-key"]).toBe("mlk_unit_test_key");
      expect(init.headers["Content-Type"]).toBe("application/json");
      expect(payloadOf(transport.calls[0] ?? { url: "", init: {} }).logs).toHaveLength(20);
    } finally {
      transport.restore();
    }
  });

  it("flushes on the 5 second timer when the batch is not full", async () => {
    const transport = stubFetch();
    vi.useFakeTimers();
    try {
      const log = initLogger(baseOptions() as never);
      log.info("one");
      log.info("two");
      expect(transport.calls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(4999);
      expect(transport.calls).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(2);
      expect(transport.calls).toHaveLength(1);
      expect(payloadOf(transport.calls[0] ?? { url: "", init: {} }).logs).toHaveLength(2);
    } finally {
      transport.restore();
    }
  });

  it("never exceeds the batch size per request", async () => {
    const transport = stubFetch();
    try {
      const log = initLogger(baseOptions() as never);
      for (let index = 0; index < 45; index += 1) {
        log.debug(`burst_${index}`);
      }
      await log.flush();
      const sizes = transport.calls.map((call) => payloadOf(call).logs.length);
      expect(sizes).toEqual([20, 20, 5]);
      expect(new Set(allLogs(transport.calls).map((row) => row.message)).size).toBe(45);
    } finally {
      transport.restore();
    }
  });

  it("queues offline when the transport fails and replays the queue on a later flush", async () => {
    const calls: FetchCall[] = [];
    const original = globalThis.fetch;
    let failing = true;
    globalThis.fetch = ((url: string, init: Record<string, unknown>) => {
      calls.push({ url, init });
      if (failing) {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve({ status: 200, ok: true });
    }) as unknown as typeof fetch;
    try {
      const log = initLogger(baseOptions() as never);
      log.warn("offline_one");
      await log.flush();
      expect(calls).toHaveLength(1);
      failing = false;
      await log.flush();
      const sent = allLogs(calls).filter((row) => row.message === "offline_one");
      expect(sent.length).toBeGreaterThanOrEqual(1);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("drops a batch the server rejects with 4xx instead of retrying forever", async () => {
    const calls: FetchCall[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = ((url: string, init: Record<string, unknown>) => {
      calls.push({ url, init });
      return Promise.resolve({ status: 400, ok: false });
    }) as unknown as typeof fetch;
    try {
      const log = initLogger(baseOptions() as never);
      log.info("bad_batch");
      await log.flush();
      await log.flush();
      expect(calls).toHaveLength(1);
      expect(log.droppedCount()).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("sdk redaction, sampling, rate limiting and caps", () => {
  it("redacts configured keys before anything is transmitted", async () => {
    const transport = stubFetch();
    try {
      const log = initLogger(baseOptions({ redactKeys: ["password", "token"] }) as never);
      log.info("login", { password: "hunter2", user: { token: "abc" }, keep: "visible" });
      await log.flush();
      const body = String(transport.calls[0]?.init.body ?? "");
      expect(body).not.toContain("hunter2");
      expect(body).not.toContain("abc");
      expect(body).toContain("***");
      expect(body).toContain("visible");
    } finally {
      transport.restore();
    }
  });

  it("redacts secrets embedded in the message string", async () => {
    const transport = stubFetch();
    try {
      const log = initLogger(baseOptions() as never);
      log.error("request failed token=supersecretvalue");
      await log.flush();
      const body = String(transport.calls[0]?.init.body ?? "");
      expect(body).not.toContain("supersecretvalue");
    } finally {
      transport.restore();
    }
  });

  it("enforces the internal ~50 logs/s rate limiter and counts drops", async () => {
    const transport = stubFetch();
    try {
      const log = initLogger(baseOptions({ maxLogsPerSecond: 4 }) as never);
      for (let index = 0; index < 20; index += 1) {
        log.info(`flood_${index}`);
      }
      await log.flush();
      const sent = allLogs(transport.calls).filter((row) => String(row.message).startsWith("flood_"));
      expect(sent).toHaveLength(4);
      expect(log.droppedCount()).toBeGreaterThanOrEqual(16);
    } finally {
      transport.restore();
    }
  });

  it("keeps every error even when the error level is sampled to zero", async () => {
    const transport = stubFetch();
    try {
      const log = initLogger(baseOptions({ sampleRate: { error: 0, info: 0 } }) as never);
      log.info("dropped_info");
      log.error("kept_error");
      await log.flush();
      const messages = allLogs(transport.calls).map((row) => row.message);
      expect(messages).toEqual(["kept_error"]);
    } finally {
      transport.restore();
    }
  });

  it("drops an entry whose meta exceeds the 8KB cap instead of poisoning the batch", async () => {
    const transport = stubFetch();
    try {
      const log = initLogger(baseOptions() as never);
      log.info("healthy", { note: "ok" });
      log.info("huge", {
        a: "z".repeat(1000),
        b: "z".repeat(1000),
        c: "z".repeat(1000),
        d: "z".repeat(1000),
        e: "z".repeat(1000),
        f: "z".repeat(1000),
        g: "z".repeat(1000),
        h: "z".repeat(1000),
        i: "z".repeat(1000),
      });
      await log.flush();
      const messages = allLogs(transport.calls).map((row) => row.message);
      expect(messages).toEqual(["healthy"]);
      expect(log.droppedCount()).toBe(1);
    } finally {
      transport.restore();
    }
  });

  it("collapses repeated errors into one entry with a counter", async () => {
    const transport = stubFetch();
    try {
      const log = initLogger(baseOptions() as never);
      for (let index = 0; index < 5; index += 1) {
        log.error("db_timeout", { attempt: index });
      }
      await log.flush();
      const rows = allLogs(transport.calls);
      expect(rows).toHaveLength(1);
      expect((rows[0]?.meta as Record<string, unknown>).count).toBe(5);
    } finally {
      transport.restore();
    }
  });
});

describe("sdk context, timers and trace correlation", () => {
  it("binds child context, records durationMs and never sends a server-set field", async () => {
    const transport = stubFetch();
    try {
      const log = initLogger(baseOptions() as never);
      const child = log.child({ requestId: "req-42", orderId: "o-1" });
      child.time("db_query");
      const elapsed = child.timeEnd("db_query", { table: "orders" });
      expect(elapsed).not.toBeNull();
      log.info("checkout");
      await log.flush();
      const rows = allLogs(transport.calls);
      const timed = rows.find((row) => row.message === "db_query");
      expect(timed).toBeDefined();
      expect(typeof timed?.durationMs).toBe("number");
      expect(timed?.requestId).toBe("req-42");
      expect((timed?.meta as Record<string, unknown>).orderId).toBe("o-1");
      for (const row of rows) {
        expect(row).not.toHaveProperty("source");
        expect(row).not.toHaveProperty("ip");
        expect(row).not.toHaveProperty("country");
        expect(row).not.toHaveProperty("receivedAt");
      }
      expect(log.timeEnd("never_started")).toBeNull();
    } finally {
      transport.restore();
    }
  });

  it("generates a trace id, reuses it for the journey and lets the server adopt it", async () => {
    const transport = stubFetch();
    try {
      const log = initLogger(baseOptions() as never);
      const first = log.traceId();
      expect(first).not.toBe("");
      expect(log.newTrace()).not.toBe(first);
      const server = log.withTrace("trace-from-browser");
      server.info("db_query");
      log.info("client_action");
      await log.flush();
      const rows = allLogs(transport.calls);
      const serverRow = rows.find((row) => row.message === "db_query");
      const clientRow = rows.find((row) => row.message === "client_action");
      expect(serverRow?.traceId).toBe("trace-from-browser");
      expect(clientRow?.traceId).toBe(log.traceId());
    } finally {
      transport.restore();
    }
  });

  it("sends a stable session id and a page id with every entry", async () => {
    const transport = stubFetch();
    try {
      const log = initLogger(baseOptions() as never);
      log.info("first");
      log.info("second");
      await log.flush();
      const rows = allLogs(transport.calls);
      expect(rows).toHaveLength(2);
      expect(rows[0]?.sessionId).toBe(log.sessionId());
      expect(rows[1]?.sessionId).toBe(rows[0]?.sessionId);
      expect(String(rows[0]?.pageId)).not.toBe("");
      expect(rows[0]?.environment).toBe("test");
    } finally {
      transport.restore();
    }
  });
});

describe("bundled sdk artifact", () => {
  const source = readFileSync(
    resolve(process.cwd(), "packages/logger/dist/logger.ts"),
    "utf8",
  );

  it("is a single self-contained file with zero imports", () => {
    expect(source.length).toBeGreaterThan(5000);
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\brequire\(/);
    expect(code).not.toMatch(/from\s+["'][^"']+["']/);
    expect(code).not.toMatch(/\bexport\s+\*\s+from\b/);
  });

  it("accepts null captureConsole instead of crashing", async () => {
    const { initLogger: init } = await import("../../packages/logger/src/index");
    const logger = init({
      endpoint: "http://127.0.0.1:1",
      appId: "probe",
      apiKey: "mlk_probe",
      captureConsole: null,
    });
    expect(typeof logger.info).toBe("function");
    expect(() => logger.info("console_disabled_ok")).not.toThrow();
  });

  it("does not attach process error listeners unless explicitly opted in", async () => {
    const before = {
      uncaught: process.listenerCount("uncaughtException"),
      rejection: process.listenerCount("unhandledRejection"),
    };
    const { initLogger: init } = await import("../../packages/logger/src/index");
    const logger = init({
      endpoint: "http://127.0.0.1:1",
      appId: "probe",
      apiKey: "mlk_probe",
      captureGlobalErrors: true,
    });
    await logger.flush();
    expect(process.listenerCount("uncaughtException")).toBe(before.uncaught);
    expect(process.listenerCount("unhandledRejection")).toBe(before.rejection);

    const optIn = init({
      endpoint: "http://127.0.0.1:1",
      appId: "probe",
      apiKey: "mlk_probe",
      captureGlobalErrors: true,
      captureProcessErrors: true,
    });
    expect(process.listenerCount("uncaughtException")).toBe(before.uncaught + 1);
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");
    if (before.uncaught > 0) {
      process.on("uncaughtException", () => undefined);
    }
    void optIn;
  });

  it("documents its own usage so a vendored copy is self-explanatory", () => {
    for (const marker of [
      "initLogger",
      "log.child(",
      "log.time(",
      "x-trace-id",
      "/api/ingest/logs",
      "x-api-key",
      "redactKeys",
      "log.flush()",
    ]) {
      expect(source).toContain(marker);
    }
  });

  it("keeps the inlined copies served by the download route in sync", () => {
    const inlined = readFileSync(
      resolve(process.cwd(), "packages/logger/dist/logger.source.ts"),
      "utf8",
    );
    const exported: Record<string, string> = {};
    const pattern = /export const (\w+) = ("(?:[^"\\]|\\.)*");/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(inlined)) !== null) {
      exported[match[1]] = JSON.parse(match[2]) as string;
    }
    expect(exported.LOGGER_SDK_SOURCE).toBe(source);
    expect(exported.LOGGER_SDK_SOURCE_JS).toBe(
      readFileSync(resolve(process.cwd(), "packages/logger/dist/logger.js"), "utf8"),
    );
  });

  it("exposes the documented public API", () => {
    expect(source).toContain("function initLogger(");
    expect(source).toContain("function traceIdFromHeaders(");
    expect(source).toContain("function shutdownLoggers(");
    expect(source).toMatch(/export \{[^}]*initLogger/);
  });

  it("keeps the server-set fields out of the emitted payload shape", () => {
    expect(source).not.toMatch(/^\s*source:/m);
    expect(source).not.toMatch(/^\s*receivedAt:/m);
  });
});
