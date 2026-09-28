import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce } from "@/lib/csp";

function directive(csp: string, name: string): string {
  const found = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  if (found === undefined) {
    throw new Error(`missing CSP directive: ${name}`);
  }
  return found;
}

describe("generateNonce", () => {
  it("returns 32 lowercase hex characters (valid CSP nonce source)", () => {
    expect(generateNonce()).toMatch(/^[a-f0-9]{32}$/);
  });

  it("never repeats across calls", () => {
    const nonces = new Set(Array.from({ length: 500 }, () => generateNonce()));
    expect(nonces.size).toBe(500);
  });
});

describe("buildCsp", () => {
  const prod = buildCsp("abc123", false);
  const dev = buildCsp("abc123", true);

  it("binds the nonce into script-src", () => {
    expect(directive(prod, "script-src")).toBe(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic'",
    );
  });

  it("locks down object, frame, base and form sources in production", () => {
    expect(directive(prod, "object-src")).toBe("object-src 'none'");
    expect(directive(prod, "frame-src")).toBe("frame-src 'none'");
    expect(directive(prod, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(prod, "base-uri")).toBe("base-uri 'self'");
    expect(directive(prod, "form-action")).toBe("form-action 'self'");
    expect(directive(prod, "default-src")).toBe("default-src 'self'");
  });

  it("keeps only the same-origin API surface in connect-src (production)", () => {
    expect(directive(prod, "connect-src")).toBe("connect-src 'self'");
  });

  it("restricts images and fonts to same-origin + data/blob", () => {
    expect(directive(prod, "img-src")).toBe("img-src 'self' blob: data:");
    expect(directive(prod, "font-src")).toBe("font-src 'self' data:");
  });

  it("never allows inline script execution in production", () => {
    expect(directive(prod, "script-src")).not.toContain("'unsafe-inline'");
  });

  it("omits unsafe-eval in production and forces https upgrades", () => {
    expect(prod).not.toContain("'unsafe-eval'");
    expect(prod).toContain("upgrade-insecure-requests");
  });

  it("adds dev-only allowances for hot reload tooling", () => {
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws:");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("emits well-formed directives", () => {
    for (const csp of [prod, dev]) {
      expect(csp.endsWith(";")).toBe(true);
      expect(csp).not.toMatch(/;;/);
      const parts = csp.split(";").filter((part) => part.trim() !== "");
      expect(parts.length).toBeGreaterThan(10);
      for (const part of parts) {
        expect(part.trim().split(/\s+/)[0]).toMatch(/^[a-z-]+$/);
      }
    }
  });
});
