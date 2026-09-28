import type { NextRequest } from "next/server";
import { authorize, errorResponse, notFound } from "@/lib/auth";
import { getProjectBySlug } from "@/lib/projects";
import { auditTrail, DEFAULT_AUDIT_LIMIT, MAX_AUDIT_LIMIT } from "@/lib/secrets";

type Context = { params: Promise<{ slug: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    await authorize(request, "secrets.view");
    const { slug } = await context.params;
    const project = await getProjectBySlug(slug);
    if (project === null) {
      throw notFound("project not found");
    }
    const raw = request.nextUrl.searchParams.get("limit");
    let limit = DEFAULT_AUDIT_LIMIT;
    if (raw !== null && raw !== "") {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_AUDIT_LIMIT) {
        return Response.json(
          { error: "invalid_request" },
          { status: 400, headers: NO_STORE },
        );
      }
      limit = parsed;
    }
    const audit = await auditTrail(String(project._id), limit);
    return Response.json({ audit }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
