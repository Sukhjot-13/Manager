import type { NextRequest } from "next/server";
import { authorize, errorResponse, notFound } from "@/lib/auth";
import { getProjectBySlug } from "@/lib/projects";
import { createApiKey, KeyError, listApiKeys } from "@/lib/keyManagement";
import { apiKeyCreateSchema } from "@/lib/validation";

type Context = { params: Promise<{ slug: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

function invalidRequest(issues?: number): Response {
  return Response.json(
    issues === undefined
      ? { error: "invalid_request" }
      : { error: "invalid_request", issues },
    { status: 400, headers: NO_STORE },
  );
}

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    await authorize(request, "keys.view");
    const { slug } = await context.params;
    const project = await getProjectBySlug(slug);
    if (project === null) {
      throw notFound("project not found");
    }
    const includeRevoked = request.nextUrl.searchParams.get("all") === "1";
    const keys = await listApiKeys(String(project._id), { includeRevoked });
    return Response.json({ keys }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    await authorize(request, "keys.manage");
    const { slug } = await context.params;
    const project = await getProjectBySlug(slug);
    if (project === null) {
      throw notFound("project not found");
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return invalidRequest();
    }
    const parsed = apiKeyCreateSchema.safeParse(body);
    if (!parsed.success) {
      return invalidRequest(parsed.error.issues.length);
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
