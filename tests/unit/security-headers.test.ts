import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

type HeaderRule = { source: string; headers: { key: string; value: string }[] };
type HeadersFn = () => Promise<HeaderRule[]>;

async function headerMap(): Promise<Map<string, string>> {
  const headersFn = nextConfig.headers as unknown as HeadersFn;
  const rules = await headersFn();
  const map = new Map<string, string>();
  for (const rule of rules) {
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
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
  });

  it("sets the headers required by plan §7 / §7.6", async () => {
    const headers = await headerMap();
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
