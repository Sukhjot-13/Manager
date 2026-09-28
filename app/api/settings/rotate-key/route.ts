import type { NextRequest } from "next/server";
import { z } from "zod";
import { authorize, errorResponse } from "@/lib/auth";
import { rotateMasterKey } from "@/lib/secrets";
import { recordAudit } from "@/lib/users";
import { clientIp } from "@/lib/visitor";

const NO_STORE = { "Cache-Control": "no-store" };

const bodySchema = z.object({
  newKey: z.string().regex(/^[0-9a-fA-F]{64}$/, "newKey must be 64 hex characters"),
  confirm: z.literal("ROTATE"),
});

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const actor = await authorize(request, "secrets.edit");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_request", issues: parsed.error.issues.length },
        { status: 400, headers: NO_STORE },
      );
    }
    const result = await rotateMasterKey(parsed.data.newKey);
    await recordAudit({
      action: "secrets.key_rotated",
      actor: actor.email,
      targetType: "vault",
      detail: { rotated: result.rotated, skipped: result.skipped, failed: result.failed },
      ip: clientIp(request.headers),
    });
    return Response.json(
      {
        rotated: result.rotated,
        skipped: result.skipped,
        failed: result.failed,
        newKeyVer: result.newKeyVer,
        errors: result.errors,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
