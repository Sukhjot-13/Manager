import type { NextRequest } from "next/server";
import { authorize, errorResponse, notFound } from "@/lib/auth";
import { revealSecret } from "@/lib/secrets";
import { clientIp } from "@/lib/visitor";

type Context = { params: Promise<{ id: string }> };

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    const principal = await authorize(request, "secrets.reveal");
    const { id } = await context.params;
    const revealed = await revealSecret(
      id,
      principal.email,
      clientIp(request.headers),
    );
    if (revealed === null) {
      throw notFound("secret not found");
    }
    return Response.json(
      { value: revealed.value },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
