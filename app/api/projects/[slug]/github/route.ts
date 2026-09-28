import type { NextRequest } from "next/server";
import { authorize, errorResponse, notFound } from "@/lib/auth";
import { getProjectBySlug, serializeProject } from "@/lib/projects";
import { refreshProjectGithub } from "@/lib/github";
import { recordAudit } from "@/lib/users";
import { clientIp } from "@/lib/visitor";

const NO_STORE = { "Cache-Control": "no-store" };

type Context = { params: Promise<{ slug: string }> };

export async function POST(request: NextRequest, context: Context): Promise<Response> {
  try {
    const actor = await authorize(request, "projects.edit");
    const { slug } = await context.params;
    const project = await getProjectBySlug(slug);
    if (project === null) {
      throw notFound("project not found");
    }
    if (project.githubRepo === "") {
      return Response.json(
        { error: "no_repository" },
        { status: 400, headers: NO_STORE },
      );
    }
    const refreshed = await refreshProjectGithub(String(project._id));
    const updated = await getProjectBySlug(slug);
    await recordAudit({
      action: "project.github_refreshed",
      actor: actor.email,
      targetType: "project",
      targetId: String(project._id),
      detail: { repo: project.githubRepo, refreshed },
      ip: clientIp(request.headers),
    });
    return Response.json(
      {
        refreshed,
        project: updated === null ? null : serializeProject(updated),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
