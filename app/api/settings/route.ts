import type { NextRequest } from "next/server";
import { authorize, errorResponse } from "@/lib/auth";
import { getSettings, updateSettings } from "@/lib/settings";
import { settingsUpdateSchema } from "@/lib/validation";
import { recordAudit } from "@/lib/users";
import { clientIp } from "@/lib/visitor";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest): Promise<Response> {
  try {
    await authorize(request, "settings.manage");
    return Response.json({ settings: await getSettings() }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest): Promise<Response> {
  try {
    const actor = await authorize(request, "settings.manage");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
    }
    const parsed = settingsUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
    }
    const settings = await updateSettings(parsed.data);
    await recordAudit({
      action: "settings.updated",
      actor: actor.email,
      targetType: "settings",
      detail: parsed.data,
      ip: clientIp(request.headers),
    });
    return Response.json({ settings }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
