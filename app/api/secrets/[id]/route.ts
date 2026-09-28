import type { NextRequest } from "next/server";
import { z } from "zod";
import { authorize, errorResponse, notFound } from "@/lib/auth";
import { deleteSecret, logSecretAction, updateSecret } from "@/lib/secrets";
import { clientIp } from "@/lib/visitor";

type Context = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

const secretPatchSchema = z.object({
  value: z.string().min(1).max(20_000).optional(),
  note: z.string().max(200).optional(),
});

export async function PATCH(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    const principal = await authorize(request, "secrets.edit");
    const { id } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "invalid_request" },
        { status: 400, headers: NO_STORE },
      );
    }
    const parsed = secretPatchSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_request", issues: parsed.error.issues.length },
        { status: 400, headers: NO_STORE },
      );
    }
    const secret = await updateSecret(id, parsed.data);
    if (secret === null) {
      throw notFound("secret not found");
    }
    await logSecretAction({
      secretId: secret.id,
      projectId: secret.projectId,
      environment: secret.environment,
      keyName: secret.key,
      action: "update",
      actor: principal.email,
      ip: clientIp(request.headers),
    });
    const { projectId, ...masked } = secret;
    void projectId;
    return Response.json({ secret: masked }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    const principal = await authorize(request, "secrets.edit");
    const { id } = await context.params;
    const removed = await deleteSecret(id);
    if (removed === null) {
      throw notFound("secret not found");
    }
    await logSecretAction({
      secretId: removed.id,
      projectId: removed.projectId,
      environment: removed.environment,
      keyName: removed.key,
      action: "delete",
      actor: principal.email,
      ip: clientIp(request.headers),
    });
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
