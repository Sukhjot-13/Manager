import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/ping/route";

describe("GET /api/ping", () => {
  it("returns ok:true", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("is never cached by browsers or CDNs", async () => {
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
