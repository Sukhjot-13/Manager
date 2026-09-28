import type { NextRequest } from "next/server";
import { z } from "zod";
import { authorize, errorResponse, notFound } from "@/lib/auth";
import { IngestError } from "@/lib/ingest";
import { getProjectBySlug, updateProject } from "@/lib/projects";
import { analyticsSummary } from "@/lib/analytics";

type Context = { params: Promise<{ slug: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

const analyticsSettingsSchema = z
  .object({ analyticsEnabled: z.boolean() })
  .strict();

function ingestFailure(error: unknown): Response | null {
  if (error instanceof IngestError) {
    return Response.json(
      { error: error.code },
      { status: error.status, headers: NO_STORE },
    );
  }
  return null;
}

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    await authorize(request, "analytics.view");
    const { slug } = await context.params;
    const project = await getProjectBySlug(slug);
    if (project === null) {
      throw notFound("project not found");
    }
    const params = request.nextUrl.searchParams;
    const summary = await analyticsSummary(String(project._id), {
      range: params.get("range") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    });
    return Response.json(summary, { headers: NO_STORE });
  } catch (error) {
    return ingestFailure(error) ?? errorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    await authorize(request, "analytics.edit");
    const { slug } = await context.params;
    const project = await getProjectBySlug(slug);
    if (project === null) {
      throw notFound("project not found");
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
    }
    const parsed = analyticsSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_request", issues: parsed.error.issues.length },
        { status: 400, headers: NO_STORE },
      );
    }
    const updated = await updateProject(slug, parsed.data);
    if (updated === null) {
      throw notFound("project not found");
    }
    return Response.json(
      { analyticsEnabled: updated.analyticsEnabled !== false },
      { headers: NO_STORE },
    );
  } catch (error) {
    return ingestFailure(error) ?? errorResponse(error);
  }
}
