import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as rootTracker } from "@/app/t.js/route";
import { GET as apiTracker } from "@/app/api/t.js/route";
import { TRACKER_PATH, TRACKER_SOURCE, getEmbedSnippet } from "@/lib/tracker";
import { TRACKER_ETAG } from "@/lib/trackerHandler";

function trackerRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://manager.example.com/t.js?v=1", { headers });
}

describe("tracker route", () => {
  it("is served from the public root path the embed snippet uses", async () => {
    expect(TRACKER_PATH).toBe("/t.js");
    const response = await rootTracker(trackerRequest());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(TRACKER_SOURCE);
  });

  it("is cacheable and fingerprintable", async () => {
    const response = await rootTracker(trackerRequest());
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("content-type")).toContain("application/javascript");
    expect(response.headers.get("etag")).toBe(TRACKER_ETAG);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers 304 for a matching ETag so embeds stay cheap", async () => {
    const first = await rootTracker(trackerRequest());
    const etag = first.headers.get("etag") ?? "";
    const second = await rootTracker(trackerRequest({ "if-none-match": etag }));
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
  });

  it("serves the identical bytes from the /api alias", async () => {
    const root = await rootTracker(trackerRequest());
    const api = await apiTracker(trackerRequest());
    expect(api.headers.get("etag")).toBe(root.headers.get("etag"));
    expect(await api.text()).toBe(await root.text());
  });

  it("changes its ETag when the tracker source changes", () => {
    expect(TRACKER_ETAG).toContain("mgr-tjs-");
    expect(TRACKER_ETAG).not.toBe(TRACKER_SOURCE.slice(0, 20));
  });

  it("embeds a versioned script tag and never leaks the key into the masked copy", () => {
    const snippet = getEmbedSnippet({
      slug: "my-site",
      key: "mak_live_abcdef123456",
      origin: "https://manager.example.com",
    });
    expect(snippet.scriptUrl).toContain("/t.js?v=");
    expect(snippet.html).toContain('data-app="my-site"');
    expect(snippet.html).toContain("mak_live_abcdef123456");
    expect(snippet.maskedHtml).toContain('data-app="my-site"');
    expect(snippet.maskedHtml).not.toContain("mak_live_abcdef123456");
    expect(snippet.hasKey).toBe(true);
  });
});
