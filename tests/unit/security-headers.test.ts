import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import nextConfig from "@/next.config";
import { trackerHeaders } from "@/lib/trackerHandler";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };
type HeadersFn = () => Promise<HeaderRule[]>;

/**
 * Merged header map, or the headers of one specific rule.
 *
 * Later rules override earlier ones for the same key, so the merged view reports the
 * tracker's cross-origin CORP rather than the site-wide same-origin one. Tests that assert
 * the site-wide policy must therefore ask for the catch-all rule by name.
 */
async function headerMap(source = "/:path*"): Promise<Map<string, string>> {
  const headersFn = nextConfig.headers as unknown as HeadersFn;
  const rules = await headersFn();
  const map = new Map<string, string>();
  for (const rule of rules.filter((r) => r.source === source)) {
    for (const header of rule.headers) {
      map.set(header.key.toLowerCase(), header.value);
    }
  }
  return map;
}

describe("next.config security posture", () => {
  it("does not advertise the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("enables react strict mode", () => {
    expect(nextConfig.reactStrictMode).toBe(true);
  });

  it("applies security headers to every path", async () => {
    const rules = await (nextConfig.headers as unknown as HeadersFn)();
    // The catch-all must stay first so the two tracker overrides win for those paths.
    expect(rules[0].source).toBe("/:path*");
    expect(rules.every((rule) => Array.isArray(rule.headers))).toBe(true);
  });

  it("overrides CORP only for the tracker, never for the whole site", async () => {
    const rules = await (nextConfig.headers as unknown as HeadersFn)();
    const relaxed = rules.filter((rule) =>
      rule.headers.some((h) => h.key === "Cross-Origin-Resource-Policy" && h.value === "cross-origin"),
    );
    expect(relaxed.map((rule) => rule.source).sort()).toEqual(["/api/t.js", "/t.js"]);
  });

  it("sets the headers required by plan §7 / §7.6", async () => {
    const headers = await headerMap();
    // These assertions describe the catch-all rule, so read that rule directly rather than
    // whatever the merged result is.
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(headers.get("strict-transport-security")).toContain("max-age=63072000");
  });

  it("disables browser features the control center never uses", async () => {
    const permissions = (await headerMap()).get("permissions-policy") ?? "";
    expect(permissions).toContain("camera=()");
    expect(permissions).toContain("microphone=()");
    expect(permissions).toContain("geolocation=()");
  });

  it("does not define CSP here (single source of truth lives in lib/csp.ts)", async () => {
    const headers = await headerMap();
    expect(headers.has("content-security-policy")).toBe(false);
  });
});

describe("tracker cross-origin delivery", () => {
  it("serves /t.js with CORP cross-origin, because a <script> is a no-cors request", () => {
    // Regression: the global CORP same-origin header made Chrome reject the tracker with
    // ERR_BLOCKED_BY_RESPONSE.NotSameOrigin, so no app has ever recorded a pageview.
    // CORS said yes the whole time, which is why nothing looked wrong.
    const headers = trackerHeaders();
    expect(headers["Cross-Origin-Resource-Policy"]).toBe("cross-origin");
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(headers["Content-Type"]).toContain("javascript");
  });

  it("keeps the lock-down headers on ordinary pages", () => {
    // Read the actual config so the global rule cannot silently be relaxed.
    const config = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toContain('{ key: "Cross-Origin-Resource-Policy", value: "same-origin" }');
    expect(config).toContain('{ source: "/t.js", headers: crossOriginHeaders }');
    expect(config).toContain('{ source: "/api/t.js", headers: crossOriginHeaders }');
  });
});
