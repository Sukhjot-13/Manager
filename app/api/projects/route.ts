import type { NextRequest } from "next/server";
import { authorize, errorResponse } from "@/lib/auth";
import { createProject, listProjects, serializeProject, ProjectSlugConflictError } from "@/lib/projects";
import { projectValidationFailure } from "@/lib/projectForm";
import { projectCreateSchema } from "@/lib/validation";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    await authorize(request, "projects.view");
    const url = request.nextUrl;
    const projects = await listProjects({
      query: url.searchParams.get("q") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      tag: url.searchParams.get("tag") ?? undefined,
    });
    return Response.json(
      { projects: projects.map(serializeProject) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    await authorize(request, "projects.create");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "invalid_json" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const parsed = projectCreateSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        projectValidationFailure(parsed.error.issues),
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const project = await createProject(parsed.data);
    return Response.json(
      { project: serializeProject(project) },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ProjectSlugConflictError) {
      return Response.json(
        { error: "slug_in_use" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    return errorResponse(error);
  }
}
