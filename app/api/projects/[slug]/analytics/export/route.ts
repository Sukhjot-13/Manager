import type { NextRequest } from "next/server";
import { authorize, errorResponse, notFound } from "@/lib/auth";
import { IngestError, MAX_EXPORT_ROWS } from "@/lib/ingest";
import { getProjectBySlug } from "@/lib/projects";
import { exportEvents } from "@/lib/analytics";

type Context = { params: Promise<{ slug: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(
  request: NextRequest,
  context: Context,
): Promise<Response> {
  try {
    await authorize(request, "analytics.export");
    const { slug } = await context.params;
    const project = await getProjectBySlug(slug);
    if (project === null) {
      throw notFound("project not found");
    }
    const params = request.nextUrl.searchParams;
    const format = params.get("format") === "json" ? "json" : "csv";
    const result = await exportEvents(
      String(project._id),
      {
        range: params.get("range") ?? undefined,
        from: params.get("from") ?? undefined,
        to: params.get("to") ?? undefined,
      },
      format,
    );
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    return new Response(result.body, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${project.slug}-events-${stamp}.${format}"`,
        ...NO_STORE,
        Pragma: "no-cache",
        Expires: "0",
        "X-Row-Count": String(result.count),
        "X-Row-Cap": String(MAX_EXPORT_ROWS),
      },
    });
  } catch (error) {
    if (error instanceof IngestError) {
      return Response.json(
        { error: error.code },
        { status: error.status, headers: NO_STORE },
      );
    }
    return errorResponse(error);
  }
}
