import type { NextRequest } from "next/server";
import { authorize, errorResponse, notFound } from "@/lib/auth";
import { deleteApiKey, revokeApiKey } from "@/lib/keyManagement";

type Context = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

export async function PATCH(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    await authorize(request, "keys.manage");
    const { id } = await context.params;
    const key = await revokeApiKey(id);
    if (key === null) {
      throw notFound("key not found");
    }
    return Response.json({ key }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    await authorize(request, "keys.manage");
    const { id } = await context.params;
    const deleted = await deleteApiKey(id);
    if (!deleted) {
      throw notFound("key not found");
    }
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
