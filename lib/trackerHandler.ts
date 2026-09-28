import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { TRACKER_SOURCE, TRACKER_VERSION } from "@/lib/tracker";

const FINGERPRINT = crypto
  .createHash("sha256")
  .update(TRACKER_SOURCE)
  .digest("hex");

export const TRACKER_ETAG = `"mgr-tjs-${TRACKER_VERSION}-${FINGERPRINT.slice(0, 16)}"`;

export function trackerHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    ETag: TRACKER_ETAG,
  };
}

export function trackerResponse(request: NextRequest): Response {
  const headers = trackerHeaders();
  const ifNoneMatch = request.headers.get("if-none-match");
  if (
    ifNoneMatch !== null &&
    ifNoneMatch.split(",").some((tag) => tag.trim() === TRACKER_ETAG)
  ) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(TRACKER_SOURCE, { status: 200, headers });
}
