import type { NextRequest } from "next/server";
import { verifyApiKey } from "@/lib/apiKeys";
import { ingestLogs, IngestError } from "@/lib/ingest";
import { MAX_BODY_BYTES } from "@/lib/validation";
import { clientIp, countryFromHeaders } from "@/lib/visitor";

export const runtime = "nodejs";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-api-key",
  "Access-Control-Max-Age": "86400",
  "Cache-Control": "no-store",
};

const GENERIC_401 = { error: "unauthorized" };

function json(body: unknown, status: number, extra?: Record<string, string>): Response {
  return Response.json(body, { status, headers: { ...CORS_HEADERS, ...extra } });
}

function isJsonContentType(request: NextRequest): boolean {
  const raw = request.headers.get("content-type");
  if (raw === null) {
    return false;
  }
  const type = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "application/json" || type.endsWith("+json");
}

function byteLengthOf(value: string): number {
  return new TextEncoder().encode(value).length;
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!isJsonContentType(request)) {
    return json({ error: "unsupported_media_type" }, 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

  const rawKey = request.headers.get("x-api-key");
  if (rawKey === null || rawKey.trim() === "") {
    return json(GENERIC_401, 401);
  }

  const bodyText = await request.text();
  if (byteLengthOf(bodyText) > MAX_BODY_BYTES) {
    return json({ error: "payload_too_large" }, 413);
  }

  const key = await verifyApiKey(rawKey.trim());
  if (key === null) {
    return json(GENERIC_401, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return json({ error: "invalid_payload" }, 400);
  }

  try {
    const result = await ingestLogs(payload, {
      key,
      headers: request.headers,
      ip: clientIp(request.headers),
      country: countryFromHeaders(request.headers),
    });
    return json(result, 200);
  } catch (error) {
    if (error instanceof IngestError) {
      if (error.code === "unauthorized") {
        return json(GENERIC_401, 401);
      }
      if (error.code === "rate_limited") {
        return json(
          { error: error.code, retryAfterSeconds: error.retryAfterSeconds },
          429,
          { "Retry-After": String(Math.max(1, error.retryAfterSeconds)) },
        );
      }
      return json({ error: error.code }, error.status);
    }
    return json({ error: "ingest_failed" }, 500);
  }
}
