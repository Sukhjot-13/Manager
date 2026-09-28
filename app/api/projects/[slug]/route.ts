import type { NextRequest } from "next/server";
import { authorize, errorResponse, notFound } from "@/lib/auth";
import {
  deleteProject,
  getProjectBySlug,
  serializeProject,
  updateProject,
} from "@/lib/projects";
import { projectUpdateSchema } from "@/lib/validation";

type Context = { params: Promise<{ slug: string }> };

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    await authorize(request, "projects.view");
    const { slug } = await context.params;
    const project = await getProjectBySlug(slug);
    if (project === null) {
      throw notFound("project not found");
    }
    return Response.json(
      { project: serializeProject(project) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    await authorize(request, "projects.edit");
    const { slug } = await context.params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "invalid_request" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const parsed = projectUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_request", issues: parsed.error.issues.length },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const updated = await updateProject(slug, parsed.data);
    if (updated === null) {
      throw notFound("project not found");
    }
    return Response.json(
      { project: serializeProject(updated) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    await authorize(request, "projects.delete");
    const { slug } = await context.params;
    const deleted = await deleteProject(slug);
    if (!deleted) {
      throw notFound("project not found");
    }
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
