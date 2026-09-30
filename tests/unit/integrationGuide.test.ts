import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { buildIntegrationGuide, integrationKey } from "@/lib/integrationGuide";

const guide = buildIntegrationGuide({
  origin: "https://manager.example.test/", projectSlug: "resume-builder",
  serverKey: "mlk_server-test", clientKey: "mck_client-test", analyticsKey: "mak_analytics-test",
});

function executable(code: string) {
  return code.replace(/^import .*;\n/gm, "").replace(/export default /g, "").replace(/export /g, "");
}

function serverHarness(configured = true) {
  const scheduled: Array<() => Promise<void>> = [];
  const children: Array<{ trace: string; error: ReturnType<typeof vi.fn> }> = [];
  const root = {
    flush: vi.fn(async () => {}),
    withTrace: vi.fn((trace: string) => {
      const child = { trace, error: vi.fn() };
      children.push(child);
      return child;
    }),
  };
  const initLogger = vi.fn(() => root);
  const api = runInNewContext(`${executable(guide.serverModule)}\n({getManagerLogger, withManagerLogs})`, {
    process: { env: configured ? { MANAGER_ENDPOINT: "https://manager.example.test", MANAGER_APP_ID: "resume-builder", MANAGER_LOG_KEY: "mlk_server-test" } : {} },
    initLogger,
    after: (callback: () => Promise<void>) => scheduled.push(callback),
    traceIdFromHeaders: (headers: Headers) => headers.get("x-trace-id"),
    crypto: { randomUUID: () => "generated-trace" },
  });
  return { api, root, initLogger, scheduled, children };
}

describe("generated Integrate guide", () => {
  it("offers matching JS/TS downloads and puts each key only in its intended channel", () => {
    expect(guide.install).toContain("?format=js");
    expect(guide.install).toContain("src/lib/manager/sdk.js");
    expect(guide.install).toContain("src/lib/manager/sdk.ts");
    expect(guide.config).toContain("MANAGER_LOG_KEY=mlk_server-test");
    expect(guide.config).toContain("NEXT_PUBLIC_MANAGER_CLIENT_KEY=mck_client-test");
    expect(guide.config).toContain("NEXT_PUBLIC_MANAGER_ANALYTICS_KEY=mak_analytics-test");
    expect(guide.provider).not.toContain("mlk_server-test");
    expect(guide.provider).not.toContain("process.env.MANAGER_LOG_KEY");
    expect(guide.analytics.html).toContain('data-key="mak_analytics-test"');
    expect(guide.http).toContain("x-api-key: mlk_server-test");
    expect(guide.http).not.toContain('"ts"');
  });

  it("uses a client key for SDK downloads when server logging is omitted", () => {
    const clientOnly = buildIntegrationGuide({ origin: "https://manager.test", projectSlug: "app", clientKey: "mck_test" });
    expect(clientOnly.install).toContain("x-manager-key: mck_test");
    expect(clientOnly.http).not.toContain("mck_test");
    expect(clientOnly.config).toContain("MANAGER_LOG_KEY=mlk_REPLACE_ME");
  });

  it("rejects wrong-kind and injected key text before building shell/env examples", () => {
    expect(integrationKey(" mck_test ", "client")).toBe("mck_test");
    for (const value of ["mak_wrong", "mlk_test\nMALICIOUS=yes", "mlk_$(echo MALICIOUS)", "mlk_`MALICIOUS`", "mlk_\"MALICIOUS"]) {
      expect(integrationKey(value, "server")).toBe("");
      const result = buildIntegrationGuide({ origin: "https://manager.test", projectSlug: "app", serverKey: value });
      expect(result.install).not.toContain("MALICIOUS");
      expect(result.config).not.toContain("MALICIOUS");
    }
  });

  it("runs the actual server example: cached logger, isolated traces and deferred flush on every exit", async () => {
    const { api, root, initLogger, scheduled, children } = serverHarness();
    const request = (trace: string) => new Request("https://app.test", { headers: { "x-trace-id": trace } });
    const handler = api.withManagerLogs(async (_request: Request, status: number, log: { trace: string }) => ({ status, trace: log.trace }));
    expect(await Promise.all([handler(request("first"), 200), handler(request("second"), 403)])).toEqual([
      { status: 200, trace: "first" }, { status: 403, trace: "second" },
    ]);
    const error = new Error("synthetic failure");
    const throwing = api.withManagerLogs(async () => { throw error; });
    await expect(throwing(new Request("https://app.test"), {})).rejects.toBe(error);
    expect(children[2].error).toHaveBeenCalledWith("Unhandled route error", { error });
    expect(initLogger).toHaveBeenCalledTimes(1);
    expect(root.withTrace.mock.calls.map(([trace]) => trace)).toEqual(["first", "second", "generated-trace"]);
    expect(scheduled).toHaveLength(3);
    expect(root.flush).not.toHaveBeenCalled();
    await Promise.all(scheduled.map((callback) => callback()));
    expect(root.flush).toHaveBeenCalledTimes(3);
  });

  it("keeps the actual route helper working with optional Manager env unset", async () => {
    const { api, initLogger, scheduled } = serverHarness(false);
    const handler = api.withManagerLogs(async (_request: Request, _context: unknown, log: unknown) => {
      expect(log).toBeUndefined();
      return "application response";
    });
    expect(await handler(new Request("https://app.test"), {})).toBe("application response");
    expect(initLogger).not.toHaveBeenCalled();
    expect(scheduled).toEqual([]);
  });

  it.each([false, true])("runs the actual browser example with client logging=%s, independent analytics and repeat mounts", (logging) => {
    const scripts: Array<{ id: string; src: string; dataset: Record<string, string> }> = [];
    const initLogger = vi.fn(() => ({ info: vi.fn() }));
    const provider = runInNewContext(`${executable(guide.provider)}\nManagerProvider`, {
      process: { env: {
        NEXT_PUBLIC_MANAGER_ENDPOINT: "https://manager.test/",
        NEXT_PUBLIC_MANAGER_APP_ID: "resume-builder",
        NEXT_PUBLIC_MANAGER_CLIENT_KEY: logging ? "mck_test" : undefined,
        NEXT_PUBLIC_MANAGER_ANALYTICS_KEY: "mak_test",
      } },
      window: {}, initLogger, useEffect: (effect: () => void) => effect(),
      document: {
        getElementById: (id: string) => scripts.find((script) => script.id === id),
        createElement: () => ({ dataset: {} }),
        head: { appendChild: (script: typeof scripts[number]) => scripts.push(script) },
      },
    });
    provider(); provider();
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe("https://manager.test/t.js?v=1");
    expect(scripts[0].dataset).toEqual({ app: "resume-builder", key: "mak_test" });
    expect(initLogger).toHaveBeenCalledTimes(logging ? 1 : 0);
  });
});
