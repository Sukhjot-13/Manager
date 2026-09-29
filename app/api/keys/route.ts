import type { NextRequest } from "next/server";
import { authorize, errorResponse, notFound } from "@/lib/auth";
import { createApiKey, listAllApiKeys, KeyError } from "@/lib/keyManagement";
import { getProjectById } from "@/lib/projects";
import { apiKeyCreateSchema } from "@/lib/validation";
import { KEY_KINDS, type KeyKind } from "@/lib/db/apikeys";

const NO_STORE = { "Cache-Control": "no-store" };

function invalidRequest(issues?: number): Response {
  return Response.json(
    issues === undefined
      ? { error: "invalid_request" }
      : { error: "invalid_request", issues },
    { status: 400, headers: NO_STORE },
  );
}

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

/**
 * Create a key from the cross-project keys screen.
 *
 * The project must be named explicitly here. This route has no slug in its path, so
 * without `projectId` in the body there is nothing to attach the key to — guessing
 * would silently file a credential under the wrong project. The project is resolved
 * and checked rather than trusted, so an unknown or bogus id is a 404 and never a
 * key bound to a project the caller did not name.
 */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    await authorize(request, "keys.manage");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return invalidRequest();
    }
    const projectId =
      typeof body === "object" && body !== null && "projectId" in body
        ? String((body as { projectId: unknown }).projectId)
        : "";
    if (projectId.trim() === "") {
      return invalidRequest(1);
    }
    const parsed = apiKeyCreateSchema.safeParse(body);
    if (!parsed.success) {
      return invalidRequest(parsed.error.issues.length);
    }
    const project = await getProjectById(projectId.trim());
    if (project === null) {
      throw notFound("project not found");
    }
    try {
      const key = await createApiKey({
        projectId: String(project._id),
        name: parsed.data.name,
        kind: parsed.data.kind,
      });
      return Response.json({ key }, { status: 201, headers: NO_STORE });
    } catch (error) {
      if (error instanceof KeyError) {
        return Response.json(
          { error: error.code },
          { status: error.status, headers: NO_STORE },
        );
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
