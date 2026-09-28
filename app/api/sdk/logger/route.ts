import type { NextRequest } from "next/server";
import { kindCanWriteLogs, verifyApiKey } from "@/lib/apiKeys";
import { LOGGER_SDK_SOURCE } from "@/packages/logger/dist/logger.source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  Expires: "0",
  "X-Content-Type-Options": "nosniff",
};

function deny(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
}

export async function GET(request: NextRequest): Promise<Response> {
  const rawKey = request.headers.get("x-manager-key");
  if (rawKey === null || rawKey.trim() === "") {
    return deny();
  }
  const key = await verifyApiKey(rawKey.trim());
  if (key === null || !kindCanWriteLogs(key.kind)) {
    return deny();
  }
  if (LOGGER_SDK_SOURCE.trim() === "") {
    return Response.json({ error: "sdk_unavailable" }, { status: 500, headers: NO_STORE });
  }
  return new Response(LOGGER_SDK_SOURCE, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="logger.ts"`,
    },
  });
}
