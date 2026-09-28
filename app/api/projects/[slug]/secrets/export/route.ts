import type { NextRequest } from "next/server";
import { z } from "zod";
import { authorize, errorResponse, forbidden, notFound } from "@/lib/auth";
import { verifyPassword } from "@/lib/authService";
import { getProjectBySlug } from "@/lib/projects";
import { ENVIRONMENTS } from "@/lib/db/secrets";
import { exportEnv } from "@/lib/secrets";
import { clientIp } from "@/lib/visitor";

type Context = { params: Promise<{ slug: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

const exportRequestSchema = z.object({
  environment: z.enum(ENVIRONMENTS),
  confirm: z.literal("EXPORT"),
  password: z.string().min(1).max(200),
});

export async function POST(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    const principal = await authorize(request, "secrets.export");
    const { slug } = await context.params;
    const project = await getProjectBySlug(slug);
    if (project === null) {
      throw notFound("project not found");
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: "invalid_request" },
        { status: 400, headers: NO_STORE },
      );
    }
    const parsed = exportRequestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_request", issues: parsed.error.issues.length },
        { status: 400, headers: NO_STORE },
      );
    }
    const verified = await verifyPassword(
      principal.email,
      parsed.data.password,
    );
    if (!verified) {
      throw forbidden("password re-entry failed");
    }
    const text = await exportEnv(
      String(project._id),
      parsed.data.environment,
      principal.email,
      clientIp(request.headers),
    );
    if (text === null) {
      throw notFound("no secrets to export");
    }
    const filename = `${project.slug}-${parsed.data.environment}.env`;
    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
