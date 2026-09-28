import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/ping/route";

describe("GET /api/ping", () => {
  it("reports readiness without leaking any secret value", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      setup: string;
      database: string;
      missingEnv: string[];
    };
    expect(typeof body.ok).toBe("boolean");
    expect(["ready", "env_missing", "database_unreachable"]).toContain(body.setup);
    expect(Array.isArray(body.missingEnv)).toBe(true);
    const serialised = JSON.stringify(body);
    expect(serialised).not.toMatch(/mongodb\+srv|:\/\//);
    for (const name of body.missingEnv) {
      expect(name).toMatch(/^[A-Z0-9_]+$/);
    }
  });

  it("is never cached by browsers or CDNs", async () => {
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
