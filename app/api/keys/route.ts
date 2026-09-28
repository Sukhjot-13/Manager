import type { NextRequest } from "next/server";
import { authorize, errorResponse } from "@/lib/auth";
import { listAllApiKeys } from "@/lib/keyManagement";
import { KEY_KINDS, type KeyKind } from "@/lib/db/apikeys";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest): Promise<Response> {
  try {
    await authorize(request, "keys.view");
    const params = request.nextUrl.searchParams;
    const kindParam = params.get("kind");
    const kind =
      kindParam !== null && (KEY_KINDS as readonly string[]).includes(kindParam)
        ? (kindParam as KeyKind)
        : undefined;
    const projectParam = params.get("project");
    const keys = await listAllApiKeys({
      includeRevoked: params.get("all") === "1",
      ...(projectParam === null || projectParam === "" ? {} : { projectId: projectParam }),
      ...(kind === undefined ? {} : { kind }),
    });
    return Response.json({ keys }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
